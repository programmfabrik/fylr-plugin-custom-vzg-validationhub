PLUGIN_NAME = custom-vzg-validationhub

L10N_FILES = l10n/$(PLUGIN_NAME).csv

#ZIP_NAME ?= custom-vzg-validationhub.zip

BUILD_DIR = build

COFFEE_FILES = \
	src/webfrontend/ValidationSelectorBaseConfig.coffee

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

all: build

include easydb-library/tools/base-plugins.make

build: clean code buildinfojson
		mkdir -p build
		cp -r l10n build
		mkdir -p build/server
		cp -r src/server/validation.js build/server
		cp build-info.json build/build-info.json

code: $(JS) $(JS_SERVER)

clean: ##clean
				rm -rf build

#zip: build
#  cd build && zip ${ZIP_NAME} -r $(PLUGIN_NAME)/
