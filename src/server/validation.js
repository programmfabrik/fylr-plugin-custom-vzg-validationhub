// make build; docker restart fylr; docker logs -f --tail 10 execserver

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
let config_objecttype_selector = false;
let frontend_language = 'de-DE';
let config_tagfilter = {
  "any": [],
  "all": [],
  "not": []
};

let qualified_for_validation = false;

const validationEndpointURL = 'fylr.validierung.gbv.de';

// logs a long string in parts
function logLongString(longString) {
  let chunks = [];
  for (let i = 0; i < longString.length; i += MAX_CHUNK_SIZE) {
    chunks.push(longString.substring(i, i + MAX_CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(chunks[i]);
  }
}

// throws api-error to frontend
function throwErrorToFrontend(error, description) {
  console.log(JSON.stringify({
    "error": {
      "code": "error.validation",
      "statuscode": 400,
      "realm": "api",
      "error": error,
      "parameters": {},
      "description": description
    }
  }));
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
    //throwErrorToFrontend("Could not read input into string: ${e.message}", e.stack);
    console.error(`Could not read input into string: ${e.message}`, e.stack);
    process.exit(1);
  }
});

process.stdin.on('end', () => {
  let data;
  let dataString;
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

  // read frontendLanguage from object's update-user
  frontend_language = (data.objects[0] && data.objects[0]._current && data.objects[0]._current._create_user && data.objects[0]._current._create_user.user && data.objects[0]._current._create_user.user.frontend_language);

  /////////////////////////////////////////
  // read pluginconfig from baseconfig

  // original mask
  original_mask = (data.objects && data.objects[0] && data.objects[0]._callback_context && data.objects[0]._callback_context.original_mask);
  // config: enabled validation
  config_enable_validation = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].enable_validation);
  // config: instance-url
  config_instanceurl = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].instance_url);
  // config: enable_debug
  config_enable_debug = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].enable_debugging);
  // config: token
  config_token = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].token);
  // config: timeout
  config_timeout = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].timeout);
  // save on timeout?
  config_save_on_timeout = (data.info.config && data.info.config.plugin && data.info.config.plugin['custom-vzg-validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'] && data.info.config.plugin['custom-vzg-validationhub'].config['VZG-Validationhub'].resolve_on_timeout);

  // if validation not enabled in config => return ok and save
  if (!config_enable_validation) {
    logLongString(JSON.stringify(data, "", "    "));
    process.exit(0);
  }

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
  data.objects.forEach(function(element) {
    delete element._current;
    delete element._owner;
    delete element._standard;
  });

  // if no selector matches -> return ok and save
  if (!qualified_for_validation) {
    //console.log(JSON.stringify(data, "", "    "));
    logLongString(JSON.stringify(data, "", "    "));
    process.exit(0);
  }

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
        // validation fine
        if (validationResponse[0]) {
          if (validationResponse[0] == true) {
            let originalDataString = JSON.stringify(data);
            logLongString(originalDataString);
            process.exit(0);
          }
        }
        // validation errors
        if (validationResponse.length) {
          var errors = [];

          validationResponse.forEach((validationResponseForOneObject) => {
            if (validationResponseForOneObject) {
              validationResponseForOneObject.forEach((errorObject) => {
                errors.push(' • ' + errorObject.message + ' (\"' + errorObject.position.jsonpointer + '\")');
              });
            }
          });
          var errorDescriptionAsText = '\n' + errors.join('\n\n');
          throwErrorToFrontend("Fehler in der Validierung des Datensatzes", errorDescriptionAsText);
        }
      }
      return;
    });
  });
  request.on('timeout', () => {
    if (config_save_on_timeout) {
      let originalDataString = JSON.stringify(data);
      logLongString(originalDataString);
      process.exit(0);
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
});