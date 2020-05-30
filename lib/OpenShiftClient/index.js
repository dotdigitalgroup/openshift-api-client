const axios = require('axios')
const { join } = require('path')
const pluralizationExceptions = require('./pluralExceptions.json')

function getData (promise) {
  try {
    return promise
      .then(response => {
        return response.data ? response.data : response
      })
      .catch(error => {
        return error
      })
  } catch (error) {
    throw error
  }
}

function getMethodNames (verb, resourceKind) {
  const names = []
  const pluralVersion = pluralizationExceptions
    .find(e => e.resourceKind === resourceKind)

  names.push(`${verb}${resourceKind}`)

  if (verb === 'list') {
    if (pluralVersion) {
      names.push(`get${pluralVersion.plural}`)
    } else {
      names.push(`get${resourceKind}s`)
    }
  }

  return names
}

module.exports = async ({ url, token }) => {
  try {
    const client = axios.create({
      baseURL: url,
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const apis = (await client.get('apis')).data.groups
      .map(({ name, preferredVersion }) => {
        return { name, version: preferredVersion.version }
      })
    let resourceLists = []
    let parsedMethods = []
    let clientSpec = {}

    apis.push(
      { name: 'api', version: 'v1' },
      { name: 'oapi', version: 'v1' }
    )
    resourceLists = await Promise.all(apis.map(({ name, version }) => {
      const path = ['api', 'oapi'].indexOf(name) < 0
        ? ['apis', name, version]
        : [name, version]

      return client.get(join(...path)).then(({ data }) => {
        data.path = join(...path)
        return data
      })
    }))

    parsedMethods = resourceLists.reduce((methods, resourceList) => {
      resourceList.resources.forEach(resource => {
        resource.verbs.forEach(verb => {
          const methodNames = getMethodNames(verb, resource.kind)
          let method

          if (methods[resourceList.groupVersion] === undefined) {
            methods[resourceList.groupVersion] = {}
          }

          if (clientSpec[resourceList.groupVersion] === undefined) {
            clientSpec[resourceList.groupVersion] = []
          }

          method = (...params) => {
            const [ namespace, resourceItem, config ] = params
            const hasConfig = config !== undefined
            const queryParams = hasConfig && config.query !== undefined
              ? config.query
              : null
            const payload = hasConfig && config.payload !== undefined
              ? config.payload
              : null
            const queryParamsKeys = Object.keys(queryParams || {})
            let route = join(
              resourceList.path,
              resource.namespaced ? `namespaces/${namespace}` : '',
              resource.name,
              resourceItem || ''
            )

            if (queryParamsKeys.length > 0) {
              route += '?'
              queryParamsKeys.forEach(qpKey => {
                route += `${qpKey}=${queryParams[qpKey]}&`
              })
              route = route.slice(0, -1)
            }

            switch (verb) {
              case 'create': {
                return getData(client.post(route, payload))
              }
              case 'delete': {
                return getData(client.delete(route))
              }
              case 'deletecollection': {
                return getData(client.delete(route))
              }
              case 'get': {
                return getData(client.get(route))
              }
              case 'list': {
                return getData(client.get(route))
              }
              case 'update': {
                return getData(client.put(route, payload))
              }
              default: {
                throw new Error('Unsupported method.')
              }
            }
          }

          methodNames.forEach(methodName => {
            methods[resourceList.groupVersion][methodName] = method
            clientSpec[resourceList.groupVersion].push({
              methodName,
              resourceKind: resource.kind,
              namespaced: resource.namespaced
            })
          })
        })
      })
      return methods
    }, {})

    parsedMethods.getMethods = () => clientSpec

    return parsedMethods
  } catch (error) {
    throw error
  }
}
