import NodeCache from 'node-cache'
import config from './config'

export const cache = new NodeCache({ stdTTL: config.CACHE_TTL_SECONDS, checkperiod: config.CACHE_TTL_SECONDS / 2 })
