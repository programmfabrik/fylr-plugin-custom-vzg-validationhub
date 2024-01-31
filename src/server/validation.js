// make build; docker restart fylr; docker logs -f --tail 10 fylr

const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const MAX_CHUNK_SIZE = 10000;

let input = '';

let config_enable_validation = false;
let config_contact = '';
let config_timeout = 5;
let config_instanceurl = '';
let config_enable_debug = false;
let config_send_l10n = false;
let config_objecttype_selector = false;
let frontend_language = 'de-DE';
let l10nData = '';
let l10nObject = {};
let config_tagfilter = {
    "any": [],
    "all": [],
    "not": []
};

let qualified_for_validation = false;

const validationEndpointURL = 'fylr.validierung.gbv.de';

// logs a long string in parts
function logLongString(longString, callback) {
    let chunks = [];
    // Break the long string into chunks
    for (let i = 0; i < longString.length; i += MAX_CHUNK_SIZE) {
        chunks.push(longString.substring(i, i + MAX_CHUNK_SIZE));
    }

    function writeNextChunk(index) {
        // Check if there are more chunks to write
        if (index < chunks.length) {
            // Write the current chunk and invoke the callback when done
            process.stdout.write(chunks[index], () => {
                // Callback to write the next chunk when the current one is complete
                writeNextChunk(index + 1);
            });
        } else {
            // All chunks have been written, invoke the final callback
            callback();
        }
    }

    // Start writing the first chunk
    writeNextChunk(0);
}

/*
Errors can be in 2 different formats and are normalized here

ERROR-Example, JSON-Pointer-Syntax
{
    "code": "validation.plugin.error",
    "error": "Fehler in der Validierung des Datensatzes",
    "package": "",
    "parameters": {
        "problems": [
            [
                {
                    "field": "/objekt/_nested:objekt__masse/0/_nested:objekt__masse__massangaben/0",
                    "message": "Die Maßeinheit \"ml\" passt nicht zur Dimension \"Breite\"."
                }
            ]
        ]
    },
    "realm": "api",
    "description": "\n • Die Maßeinheit \"ml\" passt nicht zur Dimension \"Breite\". (\"/objekt/_nested:objekt__masse/0/_nested:objekt__masse__massangaben/0\")",
    "statuscode": 400
}


ERROR-Example, fylr-Syntax

{
    "code": "validation.plugin.error",
    "error": "Server Validation Error, see editor for details",
    "package": "",
    "parameters": {
        "problems": [
            [
                {
                    "field": "validation_errors.nestedfield[0].subfield_1",
                    "message": "This is a dummy error message for subfield_1 with value Foo, we only accept empty values here...",
                },
                {
                    "field": "validation_errors.name",
                    "message": "This is a dummy error message for name with value Foo, we only accept empty values here...",
                }
            ]
        ]
    },
    "realm": "api",
    "statuscode": 400
}
*/
function normalizePointerPath(originalPath) {
    let normalizedPath = originalPath;

    // if slashes are found - do normalization
    if (originalPath.indexOf("/") !== -1) {
        // edit "/multi/2/field1" -->"/multi[2]field1"
        normalizedPath = normalizedPath.replace(/\/(\d+)\//g, "[$1]");
        // replace all slashes with dots
        normalizedPath = normalizedPath.replace(/\//g, ".");
        // remove first dot, if given
        if (normalizedPath[0] === '.') {
            normalizedPath = normalizedPath.slice(1);
        }
        // remove "_nested:" from paths 
        normalizedPath = normalizedPath.replace(/_nested:/g, "");

    } else {
        // if no slash is found, it is already fylr-syntax
    }

    return normalizedPath;
}


// get l10n from fylr and do translations
function translateFieldsInMessages(message) {
    // check if l10n exists ($$.abcabc$$)
    const regex = /\$\$\.(.*?)\$\$/g;
    const matches = message.match(regex);
    if(matches) {
        matches.forEach((match) => {
            originalMatch = match;
            match = match.replace('$$.', '');
            match = match.replace('$$', '');
            if(l10nObject[match]) {
                if(l10nObject[match][frontend_language]) {
                    message = message.replace(originalMatch, l10nObject[match][frontend_language]);
                }
            }
        });
    }
    return message;
}

// throws api-error to frontend
function throwErrorToFrontend(error, description, problems = []) {
    var result = JSON.stringify({
        "error": {
            "code": "validation.plugin.error",
            "statuscode": 400,
            "realm": "api",
            "error": error,
            "package": "",
            "parameters": {
                'problems': [problems]
            },
            "description": description
        }
    })
    console.log(result);
    process.exit(0);
}

///////////////////////////////////////
///////////////////////////////////////
///////////////////////////////////////
///////////////////////////////////////

process.stdin.on('data', d => {
    try {
        input += d.toString();
    } catch (e) {
        console.error(`Could not read input into string: ${e.message}`, e.stack);
        process.exit(1);
    }
});

process.stdin.on('end', async () => {
    let data;
    let dataString;
    let translations;
    let access_token;

    try {
        data = JSON.parse(input);
        if (!data.info) {
            data.info = {}
        }
        dataString = JSON.stringify(data);
    } catch (e) {
        console.error(`Could not parse input: ${e.message}`, e.stack);
        process.exit(1);
    }

    // get translations from fylr
    try {
        access_token = data.info.api_user_access_token;
        const apiUrl = 'http://fylr.localhost:8081/api/v1/l10n/user/CURRENT?access_token=' + access_token;

        const response = await fetch(apiUrl);

        if (!response.ok) {
            // TODO TODO TODO
            // TODO TODO TODO
            throw new Error(`Fehler beim Laden der Daten. Statuscode: ${response.status}`);
        }

        l10nData = await response.json();
        
        l10nObject = l10nData

        // zip the translations
        l10nData = JSON.stringify(l10nData);
        
        // read frontendLanguage from object's update-user
        frontend_language = (data.objects[0] && data.objects[0]._current && data.objects[0]._current._create_user && data.objects[0]._current._create_user.user && data.objects[0]._current._create_user.user.frontend_language);

        /////////////////////////////////////////
        // read pluginconfig from baseconfig

        // original mask
        original_mask = data?.objects[0]?._callback_context?.original_mask;
        // config: enabled validation
        config_enable_validation = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.enable_validation;
        // config: instance-url
        config_instanceurl = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.instance_url;
        // config: enable_debug
        config_enable_debug = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.enable_debugging;
        // config: config_send_l10n
        config_send_l10n = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.send_l10n;
        // config: token
        config_token = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.token;
        // config: timeout
        config_timeout = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.timeout;
        // save on timeout?
        config_save_on_timeout = data?.info?.config?.plugin['custom-vzg-validationhub']?.config['VZG-Validationhub']?.resolve_on_timeout;

        // if validation IS NOT ENABLED in config => return ok and save
        if (!config_enable_validation) {
            logLongString(JSON.stringify(data), () => {
                process.exit(0);
            });
        }

        // if validation IS ENABLED in config => return ok and save
        else if (config_enable_validation) {
            // if no config_token given
            if (!config_token) {
                throwErrorToFrontend("Missing configuration for validation: token", '');
            }

            // if no config_instanceurl given
            if (!config_instanceurl) {
                throwErrorToFrontend("Missing configuration for validation: instanceURL", '');
            }

            ///////////////////////////////////////////////////
            // Tagfilter-check (from pluginconfig)
            let tags_from_record = data.objects[0]._tags;
            let tagfilter_value = data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].tagfilter_select;
            config_tagfilter = tagfilter_value;
            qualified_for_validation = false;

            const tag_ids = (tags_from_record || []).map(tag => tag._id);

            if (config_tagfilter.any && config_tagfilter.any.length > 0) {
                qualified_for_validation = config_tagfilter.any.some(any => tag_ids.includes(any));
            } else if (config_tagfilter.all) {
                qualified_for_validation = config_tagfilter.all.every(all => tag_ids.includes(all));
            } else if (config_tagfilter.not) {
                qualified_for_validation = !config_tagfilter.not.some(not => tag_ids.includes(not));
            }

            //////////////////////////////////////////////////////
            // Objecttype-Filter-check (from pluginconfig)
            // -> only if not yet qualified by tagfilter
            if (!qualified_for_validation) {
                // get objecttype of object(s) in request
                let _objecttype = data.objects[0]._objecttype;
                // check objecttype vs. selector
                config_objecttype_selector = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].validation_selector && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].validation_selector);
                if (config_objecttype_selector) {
                    config_objecttype_selector = JSON.parse(config_objecttype_selector);
                    if (config_objecttype_selector.data_table)
                        if (Array.isArray(config_objecttype_selector.data_table)) {
                            config_objecttype_selector.data_table.forEach((entry) => {
                                if (entry.activate == true && entry.objecttype == _objecttype) {
                                    qualified_for_validation = true;
                                }
                            });
                        }
                }
            }

            // delete some not needed information (make it smaller for transfer = quicker)
            delete(data.info);
            data.objects.forEach(function (element) {
                delete element._current;
                delete element._owner;
                delete element._standard;
            });

            // if no selector matches -> return data and save
            if (!qualified_for_validation) {
                logLongString(JSON.stringify(data), () => {
                    process.exit(0);
                });
            } else if (qualified_for_validation) {
                // if record needs validation, send record to external fylr.validation-service
                let responseData = '';

                // prepare data to send
                let dataToSend = {
                    'referer': config_instanceurl,
                    'debug': config_enable_debug,
                    'token': config_token,
                    'frontend_language': frontend_language,
                    'objects': data.objects,
                    'original_mask': original_mask
                }
                if(config_send_l10n) {
                    dataToSend.l10n = l10nData;
                }

                // zip content, otherwise its maybe too large for POST
                let zippedDataToSend = JSON.stringify(dataToSend);
                zippedDataToSend = zlib.gzipSync(zippedDataToSend);

                const httpsOptions = {
                    hostname: validationEndpointURL,
                    port: 443,
                    path: '/',
                    method: 'POST',
                    timeout: config_timeout * 1000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                const request = https.request(httpsOptions, (response) => {
                    response.on('data', (chunk) => {
                        responseData += chunk;
                    });
                    response.on('end', () => {
                        var validationResponse = JSON.parse(responseData);
                        if (typeof validationResponse == 'object') {
                            // validation error?
                            if (validationResponse.error) {
                                var errorMessage = 'Die Validierung ist nicht korrekt konfiguriert. Ticketnr. für den Support:';
                                throwErrorToFrontend("Fehler bei der Validierung des Datensatzes", "\nMelden Sie die Ticketnummer \n#" + validationResponse['request-id'] + "\nan Ihren fylr-Administrator um Hilfe zu erhalten.");
                            }
                            let validationIsFine = false;
                            // validation fine
                            if (validationResponse[0]) {
                                if (validationResponse[0] == true) {
                                    validationIsFine = true;
                                    let originalDataString = JSON.stringify(data);
                                    logLongString(JSON.stringify(data), () => {
                                        process.exit(0);
                                    });
                                }
                            }
                            // validation errors
                            if (validationResponse.length > 0 && validationIsFine == false) {
                                var errors = [];
                                var problems = [];
                                validationResponse.forEach((validationResponseForOneObject) => {
                                    if (validationResponseForOneObject) {
                                        validationResponseForOneObject.forEach((errorObject) => {
                                            var translatedMessage = translateFieldsInMessages(errorObject.message);
                                            errors.push(' • ' + translatedMessage + ' (\"' + errorObject.position.jsonpointer + '\")');
                                            var pointerString = errorObject.position.jsonpointer;
                                            pointerString = normalizePointerPath(pointerString);
                                            problems.push({
                                                field: pointerString,
                                                message: translatedMessage
                                            });
                                        });
                                    }
                                });
                                var errorDescriptionAsText = '\n' + errors.join('\n\n');
                                throwErrorToFrontend("Fehler in der Validierung des Datensatzes", errorDescriptionAsText, problems);
                            }
                        }
                        return;
                    });
                });
                request.on('timeout', () => {
                    if (config_save_on_timeout) {
                        let originalDataString = JSON.stringify(data);
                        logLongString(JSON.stringify(data), () => {
                            process.exit(0);
                        });
                    } else {
                        throwErrorToFrontend("Timeout bei der Anfrage an den Validierungsdienst!", '');
                    }
                    request.destroy();
                });

                request.on('error', (e) => {
                    throwErrorToFrontend("Problem mit Anfrage an den Validierungsdienst!", '');
                });

                request.write(zippedDataToSend);
                request.end();
            }
        }

    } catch (error) {
        console.error("Fehler bei der API-Anfrage:", error);
    }
});
