ZIP_NAME ?= "customVZGValidationHub.zip"
PLUGIN_NAME = custom-vzg-validationhub

# coffescript-files to compile
COFFEE_FILES = \
	ValidationSelectorBaseConfig.coffee

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

all: build zip ## build and zip

build: clean buildinfojson

	mkdir -p build
	mkdir -p build/$(PLUGIN_NAME)
	mkdir -p build/$(PLUGIN_NAME)/webfrontend
	mkdir -p build/$(PLUGIN_NAME)/l10n
	mkdir -p build/$(PLUGIN_NAME)/server
	mkdir -p src/tmp # build code from coffee

	cp src/webfrontend/*.coffee src/tmp
	cd src/tmp && coffee -b --compile ${COFFEE_FILES} # bare-parameter is obligatory!
	cat src/tmp/*.js > build/$(PLUGIN_NAME)/webfrontend/custom-vzg-validationhub.js
	rm -rf src/tmp # clean tmp

	cp src/server/validation.js build/$(PLUGIN_NAME)/server/validation.js

	cp l10n/custom-vzg-validationhub.csv build/$(PLUGIN_NAME)/l10n/custom-vzg-validationhub.csv # copy l10n

	cp manifest.master.yml build/$(PLUGIN_NAME)/manifest.yml # copy manifest

	cp build-info.json build/$(PLUGIN_NAME)/build-info.json

buildinfojson:
	repo=`git remote get-url origin | sed -e 's/\.git$$//' -e 's#.*[/\\]##'` ;\
	rev=`git show --no-patch --format=%H` ;\
	lastchanged=`git show --no-patch --format=%ad --date=format:%Y-%m-%dT%T%z` ;\
	builddate=`date +"%Y-%m-%dT%T%z"` ;\
	echo '{' > build-info.json ;\
	echo '  "repository": "'$$repo'",' >> build-info.json ;\
	echo '  "rev": "'$$rev'",' >> build-info.json ;\
	echo '  "lastchanged": "'$$lastchanged'",' >> build-info.json ;\
	echo '  "builddate": "'$$builddate'"' >> build-info.json ;\
	echo '}' >> build-info.json

clean: ## clean
				rm -rf build

zip: build ## zip file
			cd build && zip ${ZIP_NAME} -r $(PLUGIN_NAME)/
