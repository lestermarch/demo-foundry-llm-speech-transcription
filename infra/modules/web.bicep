param location string
param tags object
param planName string
param appName string
param identityResourceId string
param identityClientId string
param speechEndpoint string
param inferenceEndpoint string
param availableModels string

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: identityResourceId
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appCommandLine: 'npm start'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'NODE_ENV', value: 'development' }
        { name: 'IS_UNRESTRICTED', value: 'true' }
        { name: 'AZURE_CLIENT_ID', value: identityClientId }
        { name: 'SPEECH_ENDPOINT', value: speechEndpoint }
        { name: 'FOUNDRY_INFERENCE_ENDPOINT', value: inferenceEndpoint }
        { name: 'AVAILABLE_MODELS', value: availableModels }
        { name: 'USE_HTTPS', value: 'false' }
      ]
    }
  }
}

output uri string = 'https://${app.properties.defaultHostName}'
output name string = app.name
