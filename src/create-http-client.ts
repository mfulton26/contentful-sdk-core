import { AxiosRequestHeaders } from 'axios'
import type { AxiosStatic } from 'axios'
import copy from 'fast-copy'
import asyncToken from './async-token'

import rateLimitRetry from './rate-limit'
import rateLimitThrottle from './rate-limit-throttle'
import type { AxiosInstance, CreateHttpClientParams, DefaultOptions } from './types'

// Matches 'sub.host:port' or 'host:port' and extracts hostname and port
// Also enforces toplevel domain specified, no spaces and no protocol
const HOST_REGEX = /^(?!\w+:\/\/)([^\s:]+\.?[^\s:]+)(?::(\d+))?(?!:)$/

/**
 * Create pre-configured axios instance
 * @private
 * @param {AxiosStatic} axios - Axios library
 * @param {CreateHttpClientParams} options - Initialization parameters for the HTTP client
 * @return {AxiosInstance} Initialized axios instance
 */
export default function createHttpClient(
  axios: AxiosStatic,
  options: CreateHttpClientParams
): AxiosInstance {
  const defaultConfig = {
    insecure: false as const,
    retryOnError: true as const,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logHandler: (level: string, data: any): void => {
      if (level === 'error' && data) {
        const title = [data.name, data.message].filter((a) => a).join(' - ')
        console.error(`[error] ${title}`)
        console.error(data)
        return
      }
      console.log(`[${level}] ${data}`)
    },
    // Passed to axios
    headers: {} as AxiosRequestHeaders,
    httpAgent: false as const,
    httpsAgent: false as const,
    timeout: 30000,
    throttle: 0,
    basePath: '',
    adapter: undefined,
    maxContentLength: 1073741824, // 1GB
    maxBodyLength: 1073741824, // 1GB
  }
  const config = {
    ...defaultConfig,
    ...options,
  }

  if (!config.accessToken) {
    const missingAccessTokenError = new TypeError('Expected parameter accessToken')
    config.logHandler('error', missingAccessTokenError)
    throw missingAccessTokenError
  }

  // Construct axios baseURL option
  const protocol = config.insecure ? 'http' : 'https'
  const space = config.space ? `${config.space}/` : ''
  let hostname = config.defaultHostname
  let port: number | string = config.insecure ? 80 : 443
  if (config.host && HOST_REGEX.test(config.host)) {
    const parsed = config.host.split(':')
    if (parsed.length === 2) {
      ;[hostname, port] = parsed
    } else {
      hostname = parsed[0]
    }
  }

  // Ensure that basePath does start but not end with a slash
  if (config.basePath) {
    config.basePath = `/${config.basePath.split('/').filter(Boolean).join('/')}`
  }

  const baseURL =
    options.baseURL || `${protocol}://${hostname}:${port}${config.basePath}/spaces/${space}`

  if (!config.headers.Authorization && typeof config.accessToken !== 'function') {
    config.headers.Authorization = 'Bearer ' + config.accessToken
  }

  const axiosOptions: DefaultOptions = {
    // Axios
    baseURL,
    headers: config.headers,
    httpAgent: config.httpAgent,
    httpsAgent: config.httpsAgent,
    proxy: config.proxy,
    timeout: config.timeout,
    adapter: config.adapter,
    maxContentLength: config.maxContentLength,
    maxBodyLength: config.maxBodyLength,
    // Contentful
    logHandler: config.logHandler,
    responseLogger: config.responseLogger,
    requestLogger: config.requestLogger,
    retryOnError: config.retryOnError,
  }

  const instance = axios.create(axiosOptions) as AxiosInstance
  instance.httpClientParams = options

  /**
   * Creates a new axios instance with the same default base parameters as the
   * current one, and with any overrides passed to the newParams object
   * This is useful as the SDKs use dependency injection to get the axios library
   * and the version of the library comes from different places depending
   * on whether it's a browser build or a node.js build.
   * @private
   * @param {CreateHttpClientParams} newParams - Initialization parameters for the HTTP client
   * @return {AxiosInstance} Initialized axios instance
   */
  instance.cloneWithNewParams = function (
    newParams: Partial<CreateHttpClientParams>
  ): AxiosInstance {
    return createHttpClient(axios, {
      ...copy(options),
      ...newParams,
    })
  }

  /**
   * Apply interceptors.
   * Please note that the order of interceptors is important
   */

  if (config.onBeforeRequest) {
    instance.interceptors.request.use(config.onBeforeRequest)
  }

  if (typeof config.accessToken === 'function') {
    asyncToken(instance, config.accessToken)
  }

  if (config.throttle) {
    rateLimitThrottle(instance, config.throttle)
  }
  rateLimitRetry(instance, config.retryLimit)

  if (config.onError) {
    instance.interceptors.response.use((response) => response, config.onError)
  }

  return instance
}
