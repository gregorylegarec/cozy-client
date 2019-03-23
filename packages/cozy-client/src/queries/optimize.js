import groupBy from 'lodash/groupBy'
import isEqual from 'lodash/isEqual'
import flatten from 'lodash/flatten'
import uniq from 'lodash/uniq'
import uniqWith from 'lodash/uniqWith'
import { QueryDefinition } from './dsl'

const isIdQuery = query => query.id || query.ids

/**
 * Reduce the number of queries used to fetch documents.
 *
 * - Deduplication of queries
 * - Groups id queries
 *
 * @param  {QueryDefinition[]} queries - Queries to optimized
 * @return {QueryDefinition[]} Optimized queries
 * @private
 */
const optimizeQueries = queries => {
  const optimizedQueryMap = new Map()
  const byDoctype = groupBy(queries, q => q.doctype)

  for (const queries of Object.values(byDoctype)) {
    const { idQueries = [], others = [] } = groupBy(
      queries,
      q => (isIdQuery(q) ? 'idQueries' : 'others')
    )

    if (idQueries.length > 0) {
      const groupedIdQueries = new QueryDefinition({
        doctype: queries[0].doctype,
        ids: uniq(flatten(idQueries.map(q => q.id || q.ids)))
      })
      optimizedQueryMap.set(groupedIdQueries, idQueries)
    }

    // Deduplicate before concataining
    const deduplicatedQueries = uniqWith(others, isEqual)

    for (const query of deduplicatedQueries) {
      optimizedQueryMap.set(query, others.filter(q => isEqual(query, q)))
    }
  }

  return optimizedQueryMap
}

export default optimizeQueries
