@description('Name of the AI Foundry (AIServices) account on which to grant roles.')
param foundryAccountName string

@description('Name of the AI Foundry project on which to grant roles.')
param foundryProjectName string

@description('Principal ID of the web app managed identity.')
param appPrincipalId string

@description('Optional principal ID for the developer running azd (so local DefaultAzureCredential works).')
param userPrincipalId string = ''

var cognitiveServicesUser = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var azureAiUser = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' existing = {
  name: foundryAccountName
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' existing = {
  parent: account
  name: foundryProjectName
}

resource appCogSvc 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, appPrincipalId, cognitiveServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUser)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource appAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: project
  name: guid(project.id, appPrincipalId, azureAiUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUser)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource userCogSvc 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  scope: account
  name: guid(account.id, userPrincipalId, cognitiveServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUser)
    principalId: userPrincipalId
    principalType: 'User'
  }
}

resource userAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(userPrincipalId)) {
  scope: project
  name: guid(project.id, userPrincipalId, azureAiUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUser)
    principalId: userPrincipalId
    principalType: 'User'
  }
}
