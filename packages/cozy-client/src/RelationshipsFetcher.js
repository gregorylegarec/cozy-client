import flatten from 'lodash/flatten'
import uniqWith from 'lodash/uniqWith'

import { QueryDefinition } from './queries/dsl'
import { ensureArray } from './utils'
import optimizeQueries from './queries/optimize'
import { responseToRelationship } from './associations/helpers'

const isSameDocument = (docA, docB) =>
  docA._id === docB._id && docA._type === docB._type

/**
 * Relationships fetcher is in charge of fetching all document referenced in
 * relationships or specified by Association objects in schema defintion.
 *
 * Associations are defining a static `query` return us a QueryDefinition.
 * RelationshipsFetcher collects all thoses QueryDefinition, optimize them,
 * execute optimized QueryDefinition and reaffect the results to the original
 * QueryDefinitions.
 *
 * The main difficulty is to keep a track of which optimized QueryDefinition is
 * related to which initial QueryDefinition. To do so, we use `Map`
 * instances with QueryDefinition as indexes.
 *
 * The relationships will be hydrated into the original document later, during
 * a call to `hydrateDocuments()`
 */
export class RelationshipsFetcher {
  /**
   * Object where all queries values from Association.query() will be stored as
   * keys.
   *
   * Values will be objects with `doc` and `relationship`  properties
   *
   * @type {Map}
   */
  queryMap = null

  constructor(client, response = {}, relationshipsByName = {}) {
    this.client = client
    this.response = response
    this.responseDocs = ensureArray(response.data)
    this.relationshipsByName = relationshipsByName

    this.queryMap = new Map()
  }

  /**
   * Return the original response hydrated with relationships
   * for every document
   * @return {Promise} Promise of hydrated response
   */
  async fetch() {
    if (!this.responseDocs.length) return this.response
    this._prepareQueries()
    this._optimizeQueries()
    await this._executeQueries()
    const response = this._injectResponses()
    const included = this._getIncluded()
    return { ...response, included }
  }

  _injectResponse(targetDoc, relationshipName) {
    const initialQuery = [...this.queryMap.entries()]
      .filter(({ 1: { doc, relationship } }) => {
        return (
          isSameDocument(doc, targetDoc) && relationship === relationshipName
        )
      })
      .map(([key]) => key)[0]

    if (!initialQuery) {
      return targetDoc
    }

    const optimizedQuery = [...this._optimizedQueries.entries()]
      .filter(({ 1: initialQueries }) => initialQueries.includes(initialQuery))
      .map(([key]) => key)[0]

    const response = this._optimizedQueryResponses.get(optimizedQuery)

    if (!response) {
      return targetDoc
    }

    const filteredResponse

    targetDoc.relationships[relationshipName] = responseToRelationship(response)
    return targetDoc
  }

  _injectResponses() {
    const documentsWithRelationships = []

    for (let doc of this.responseDocs) {
      doc.relationships = doc.relationships || {}
      for (const relationshipName in this.relationshipsByName) {
        const relationship = this.relationshipsByName[relationshipName]
        if (!relationship.inverted) {
          doc = this._injectResponse(doc, relationshipName)
        }
      }
      documentsWithRelationships.push(doc)
    }
    return { data: documentsWithRelationships }
  }

  _getIncluded() {
    const included = []

    // All queries which are not QueryDefinition (expected to be document
    // arrays)
    included.push(
      ...flatten(
        Array.from(this.queryMap.keys())
          .filter(q => !(q instanceof QueryDefinition))
          .map(ensureArray)
      )
    )

    for (const response of this._optimizedQueryResponses.values()) {
      included.push(...ensureArray(response.included || response.data))
    }
    return uniqWith(included, isSameDocument)
  }

  /**
   * Retrieves all query definitions and document from all document associations
   * Store query values into `queriesValues` Map.
   */
  async _prepareQueries() {
    for (const doc of this.responseDocs) {
      await this._prepareDocQueries(doc)
    }
  }

  /**
   * Arranges all QueryDefinition to fetch documents from relationships into
   * the Map property `this._queryMap`.
   *
   * @param  {Object}  doc Document
   * @return {Map}     Map indexed by QueryDefinitions (or document arrays),
   * containing `{ doc, relationshipName }` objects.
   */
  _prepareDocQueries(doc) {
    for (const relationshipName in this.relationshipsByName) {
      const query = this._getQueryFromRelationship(doc, relationshipName)
      if (query) {
        this.queryMap.set(query, { doc: doc, relationship: relationshipName })
      }
    }
  }

  /**
   * Get relationship query value by calling static method `query` on
   * Association class
   *
   * @param  {Object}  doc          The document to get association query value
   * @param  {Object}  relationship A relationship object
   * @return {QueryDefinition|Array} QueryDefinition or an array of document.
   */
  _getQueryFromRelationship(doc, relationshipName) {
    const relationship = this.relationshipsByName[relationshipName]
    return relationship.type.query(doc, this.client, relationship)
  }

  /**
   * Run the optimized queries and store the response for each query into the
   * Map object `this._optimizedQueryResponses`.
   */
  async _executeQueries() {
    this._optimizedQueryResponses = new Map()
    for (const query of this._optimizedQueries.keys()) {
      this._optimizedQueryResponses.set(query, await this.client.query(query))
    }
  }

  // Now the hard part, we need to store QueryDefinition AND optimized
  // QueryDefinition and then retrieve which optimization contains which
  // QueryDefinition
  /**
   * From the Map property `this.queryMap`, generates a list of optimized
   * QueryDefinition to minimize the number of requests sent.
   *
   * Also keep a track of which optimized QueryDefinition optimizes which
   * QueryDefinition : the Map property `this.optimizedQueries` will store
   * an array of QueryDefinitions indexed by the related optimized
   * QueryDefinition.
   */
  _optimizeQueries() {
    this._optimizedQueries = optimizeQueries(
      Array.from(this.queryMap.keys()).filter(
        queryDef => queryDef instanceof QueryDefinition
      )
    )
  }
}

export default RelationshipsFetcher
