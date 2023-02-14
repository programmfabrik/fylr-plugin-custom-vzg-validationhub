class ValidationSelectorBaseConfig extends BaseConfigPlugin
  getFieldDefFromParm: (baseConfig, pname, def, parent_def) ->

    # Hier Validierung für Objekttypen ohne Tags konfigurieren! :-)

    if def.plugin_type != "validation-selector"
      return

    field =
      type: CUI.Form
      name: "validation_selector"
      fields: [
        type: CUI.DataTable
        name: "data_table"
        fields: [
          form:
            label: $$("baseconfig.validation.selector.objecttype.label")
          type: CUI.Input
          name: "objecttype"
        ,
          form:
            label: $$("baseconfig.validation.selector.validierung.label")
          type: CUI.Checkbox
          text: $$("baseconfig.validation.selector.validierung.activate.label")
          name: "activate"
        ]
      ]
    field

CUI.ready =>
  BaseConfig.registerPlugin(new ValidationSelectorBaseConfig())
