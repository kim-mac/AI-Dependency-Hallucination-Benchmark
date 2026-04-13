import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import axiosRetry from 'axios-retry'
import config from './config'
import logger from './logger'

export const axiosInstance: AxiosInstance = axios.create({
  timeout: config.HTTP_TIMEOUT_MS,
  // baseURL not set because APIs are different
})

axiosRetry(axiosInstance, {
  retries: config.RETRY_COUNT,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // retry on network errors or 5xx
    return axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error)
  },
})

export const fetchPrice = async (url: string, productId: string): Promise<number> => {
  try {
    const response = await axiosInstance.get(url, {
      params: { productId },
    })
    // Assume response { price: number }
    if (response.data && typeof response.data.price === 'number') {
      logger.debug(`Fetched price from ${url}: ${response.data.price}`)
      return response.data.price
    }
    throw new Error(`Invalid response format from ${url}`)
  } catch (err) {
    logger.error(`Error fetching price from ${url}`, { error: err })
    throw err
  }
}
