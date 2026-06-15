targetScope = 'subscription'

@minLength(1)
@maxLength(32)
@description('Name of the azd environment. Used to tag and name resources.')
param environmentName string

@minLength(1)
@description('Azure region for all resources. MAI-Transcribe-1.5 requires an LLM-Speech-capable region.')
@allowed([
  'swedencentral'
  'eastus2'
  'westus3'
])
param location string = 'swedencentral'

@description('Object ID of the user / SP running azd. Granted data-plane roles on the Foundry resource so you can hit it locally.')
param principalId string = ''

@description('Models to deploy on the Foundry account. Each becomes a deployment with name == model name. Adjust `version` to a valid version listed in the Foundry portal if deployment fails.')
param models array = [
  {
    name: 'gpt-5.4'
    version: '2026-03-05'
    format: 'OpenAI'
    skuName: 'GlobalStandard'
    capacity: 50
  }
  {
    name: 'gpt-5.4-nano'
    version: '2026-03-17'
    format: 'OpenAI'
    skuName: 'GlobalStandard'
    capacity: 100
  }
]

var abbr = uniqueString(subscription().id, environmentName, location)
var resourceToken = toLower(substring(abbr, 0, 8))
var tags = {
  'azd-env-name': environmentName
  workload: 'mai-transcribe-demo'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module foundry 'modules/foundry.bicep' = {
  scope: rg
  name: 'foundry'
  params: {
    location: location
    tags: tags
    accountName: 'aif-${resourceToken}'
    projectName: 'proj-${resourceToken}'
    models: models
  }
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    location: location
    tags: tags
    name: 'id-${resourceToken}'
  }
}

module rbac 'modules/rbac.bicep' = {
  scope: rg
  name: 'rbac'
  params: {
    foundryAccountName: foundry.outputs.accountName
    foundryProjectName: foundry.outputs.projectName
    appPrincipalId: identity.outputs.principalId
    userPrincipalId: principalId
  }
}

module web 'modules/web.bicep' = {
  scope: rg
  name: 'web'
  params: {
    location: location
    tags: tags
    planName: 'plan-${resourceToken}'
    appName: 'app-${resourceToken}'
    identityResourceId: identity.outputs.id
    identityClientId: identity.outputs.clientId
    speechEndpoint: foundry.outputs.speechEndpoint
    inferenceEndpoint: foundry.outputs.inferenceEndpoint
    availableModels: join(map(models, m => m.name), ',')
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_FOUNDRY_ACCOUNT string = foundry.outputs.accountName
output AZURE_FOUNDRY_PROJECT string = foundry.outputs.projectName
output SPEECH_ENDPOINT string = foundry.outputs.speechEndpoint
output FOUNDRY_INFERENCE_ENDPOINT string = foundry.outputs.inferenceEndpoint
output AVAILABLE_MODELS string = join(map(models, m => m.name), ',')
output WEB_URI string = web.outputs.uri
