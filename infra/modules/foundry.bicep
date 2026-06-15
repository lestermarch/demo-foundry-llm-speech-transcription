@description('Region for the Foundry resource.')
param location string

@description('Tags applied to the account and project.')
param tags object

@description('Name of the AI Foundry (AIServices) account.')
param accountName string

@description('Name of the AI Foundry project under the account.')
param projectName string

@description('Models to deploy on the account.')
param models array

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    allowProjectManagement: true
  }
}

@batchSize(1)
resource deployments 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = [for m in models: {
  parent: account
  name: m.name
  sku: {
    name: m.skuName
    capacity: m.capacity
  }
  properties: {
    model: {
      format: m.format
      name: m.name
      version: m.version
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}]

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectName
    description: 'MAI-Transcribe-1.5 demo project'
  }
}

output accountName string = account.name
output projectName string = project.name
output speechEndpoint string = 'https://${account.name}.cognitiveservices.azure.com'
output inferenceEndpoint string = 'https://${account.name}.services.ai.azure.com/models'
