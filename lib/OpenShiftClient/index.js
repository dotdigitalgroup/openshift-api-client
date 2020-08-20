const axios = require('axios')
const { join } = require('path')
const pluralizationExceptions = require('./pluralExceptions.json')

function capitalize (text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function getData (promise) {
  try {
    return promise
      .then(response => {
        return response.data ? response.data : response
      })
      .catch(error => {
        throw error
      })
  } catch (error) {
    throw error
  }
}

function getMethodNames (verb, resourceKind, path) {
  const names = []
  const methodHasMultipleSegs = path.includes('/')
  const pluralVersion = pluralizationExceptions
    .find(e => e.resourceKind === resourceKind)
  const methodLastSeg = methodHasMultipleSegs
    ? capitalize(path.split('/')[1])
    : ''

  names.push(`${verb}${resourceKind}${methodLastSeg}`)

  if (verb === 'list') {
    if (pluralVersion) {
      names.push(`get${pluralVersion.plural}`)
    } else {
      names.push(`get${resourceKind}s`)
    }
  }

  return names
}

function parseMethodParams (namespaced, params = []) {
  try {
    const argsBitmap = [
      params.length === 0,
      params.length === 1 && typeof params[0] === 'string',
      params.length === 1 && typeof params[0] === 'object',
      params.length === 2 && typeof params[0] === 'string'
        && typeof params[1] === 'object',
      params.length === 2 && typeof params[0] === 'string'
        && typeof params[1] === 'string',
      params.length === 3 && typeof params[0] === 'string'
        && typeof params[1] === 'string' && typeof params[2] === 'object'
    ].reduce((acc, e) => { acc += e ? '1' : '0'; return acc }, '')
    let output = {
      namespace: null,
      resourceItem: null,
      config: {
        query: null,
        body: null
      }
    }

    switch (argsBitmap) {
      case '010000': {
        output.namespace = params[0]
        break
      }
      case '001000': {
        output.config = params[0]
        break
      }
      case '000100': {
        output.namespace = params[0]
        output.config = params[1]
        break
      }
      case '000010': {
        output.namespace = params[0]
        output.resourceItem = params[1]
        break
      }
      case '000001': {
        output.namespace = params[0]
        output.resourceItem = params[1]
        output.config = params[2]
        break
      }
    }

    if (namespaced && !output.namespace) {
      throw new Error('This method should contain at least a namespace.')
    }

    return output
  } catch (error) {
    throw error
  }
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
          const methodNames = getMethodNames(verb, resource.kind, resource.name)
          let method

          if (methods[resourceList.path] === undefined) {
            methods[resourceList.path] = {}
          }

          if (clientSpec[resourceList.path] === undefined) {
            clientSpec[resourceList.path] = []
          }

          method = (...params) => {
            const { namespace, resourceItem, config } = parseMethodParams(
              resource.namespaced,
              params
            )
            const queryParams = config.query
            const payload = config.body
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
                return getData(
                  client.post(
                    route,
                    payload,
                    {
                      headers: {
                        'Content-Type': 'application/json'
                      }
                    }
                  )
                )
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
                return getData(
                  client.put(
                    route,
                    payload,
                    {
                      headers: {
                        'Content-Type': 'application/json'
                      }
                    }
                  )
                )
              }
              case 'patch': {
                return getData(
                  client.patch(
                    route,
                    payload,
                    {
                      headers: {
                        'Content-Type': 'application/strategic-merge-patch+json'
                      }
                    }
                  )
                )
              }
              default: {
                throw new Error('Unsupported method.')
              }
            }
          }

          methodNames.forEach(methodName => {
            methods[resourceList.path][methodName] = method
            clientSpec[resourceList.path].push({
              methodName,
              resourceKind: resource.kind,
              namespaced: resource.namespaced
            })
          })
        })
      })
      return methods
    }, {})

    parsedMethods.getMethods = format => {
      if (format === 'markdown') {
        return Object.keys(clientSpec).reduce((acc, apiName) => {
          acc += `### ${apiName}\n\n`

          clientSpec[apiName].forEach(({ methodName, namespaced }) => {
            acc += `- ${methodName}(${namespaced ? 'namespace' : ''})\n`
          })

          acc += '\n'
          return acc
        }, '')
      }

      return clientSpec
    }

    parsedMethods.customCall = (method, ...params) => {
      const [ url, data = null ] = params

      return getData(client[method](url, data))
    }

    return parsedMethods
  } catch (error) {
    throw error
  }
}
