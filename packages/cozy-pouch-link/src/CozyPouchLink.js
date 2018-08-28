import { MutationTypes, CozyLink, getDoctypeFromOperation } from 'cozy-client'
import PouchDB from 'pouchdb'
import PouchDBFind from 'pouchdb-find'
import omit from 'lodash/omit'
import defaults from 'lodash/defaults'

import { withoutDesignDocuments } from './helpers'
import { getIndexNameFromFields, getIndexFields } from './mango'
import * as jsonapi from './jsonapi'
import PouchManager from './PouchManager'
PouchDB.plugin(PouchDBFind)

const parseMutationResult = (original, res) => {
  return { ...original, ...omit(res, 'ok') }
}

const DEFAULT_OPTIONS = {
  replicationInterval: 30 * 1000
}

const addBasicAuth = (url, basicAuth) => {
  return url.replace('//', `//${basicAuth}`)
}

const sanitized = doc => omit(doc, '_type')
export const getReplicationURL = (uri, token, doctype) => {
  const basicAuth = token.toBasicAuth()
  const authenticatedURL = addBasicAuth(uri, basicAuth)
  return `${authenticatedURL}/data/${doctype}`
}

const doNothing = () => {}
export const isExpiredTokenError = pouchError => {
  return pouchError.error === 'code=400, message=Expired token'
}

/**
 * Link to be passed to cozy-client to support CouchDB. It instantiates
 * PouchDB collections for each doctype that it supports and knows how
 * to respond to queries and mutations.
 */
export default class PouchLink extends CozyLink {
  constructor(opts = {}) {
    const options = defaults({}, opts, DEFAULT_OPTIONS)
    super(options)
    const { doctypes } = options
    this.options = options
    if (!doctypes) {
      throw new Error(
        "PouchLink must be instantiated with doctypes it manages. Ex: ['io.cozy.bills']"
      )
    }
    this.doctypes = doctypes
    this.indexes = {}
  }

  getReplicationURL(doctype) {
    if (!this.client.token) {
      throw new Error(
        "Can't get replication URL since the client doesn't have a token"
      )
    }
    if (!this.client.uri) {
      throw new Error(
        "Can't get replication URL since the client doesn't have a URI"
      )
    }
    return getReplicationURL(this.client.uri, this.client.token, doctype)
  }

  async registerClient(client) {
    this.client = client
    if (this.pouches) {
      await this.pouches.destroy()
    }
    this.pouches = new PouchManager(this.doctypes, {
      getReplicationURL: this.getReplicationURL.bind(this),
      onError: err => this.onSyncError(err)
    })
    if (client && this.options.initialSync) {
      this.pouches.startReplications()
    }
  }

  async reset() {
    await this.pouches.destroy()
    this.client = undefined
  }

  onSync() {
    this.synced = true
  }

  async onSyncError(error) {
    if (isExpiredTokenError(error)) {
      try {
        await this.client.renewAuthorization()
        this.pouches.startReplicationLoop()
      } catch (err) {
        console.warn('Could not refresh token, replication has stopped', err)
      }
    } else {
      console.warn('CozyPouchLink: Synchronization error', error)
    }
  }

  getPouch(doctype) {
    return this.pouches.getPouch(doctype)
  }

  supportsOperation(operation) {
    const impactedDoctype = getDoctypeFromOperation(operation)
    return !!this.getPouch(impactedDoctype)
  }

  request(operation, result = null, forward = doNothing) {
    if (!this.synced) {
      return forward(operation)
    }

    // Forwards if doctype not supported
    if (!this.supportsOperation(operation)) {
      return forward(operation)
    }

    if (operation.mutationType) {
      return this.executeMutation(operation)
    } else {
      return this.executeQuery(operation)
    }
  }

  hasIndex(name) {
    return Boolean(this.indexes[name])
  }

  async ensureIndex(doctype, query) {
    const fields = getIndexFields(query)
    const name = getIndexNameFromFields(fields)
    const absName = `${doctype}/${name}`
    const db = this.pouches.getPouch(doctype)
    if (this.indexes[absName]) {
      return this.indexes[absName]
    } else {
      const index = await db.createIndex({
        index: {
          fields: fields
        }
      })
      this.indexes[absName] = index
      return index
    }
  }

  async executeQuery({ doctype, selector, sort, fields, limit }) {
    const db = this.getPouch(doctype)
    let res
    if (!selector && !fields && !sort) {
      res = await db.allDocs({
        include_docs: true
      })
      res = withoutDesignDocuments(res)
    } else {
      const findOpts = {
        sort,
        selector,
        fields,
        limit
      }
      await this.ensureIndex(doctype, findOpts)
      res = await db.find(findOpts)
    }
    return jsonapi.fromPouchResult(res, true, doctype)
  }

  async executeMutation(mutation, result, forward) {
    let pouchRes
    switch (mutation.mutationType) {
      case MutationTypes.CREATE_DOCUMENT:
        pouchRes = await this.createDocument(mutation)
        break
      case MutationTypes.UPDATE_DOCUMENT:
        pouchRes = await this.updateDocument(mutation)
        break
      case MutationTypes.DELETE_DOCUMENT:
        pouchRes = await this.deleteDocument(mutation)
        break
      case MutationTypes.ADD_REFERENCES_TO:
        pouchRes = await this.addReferencesTo(mutation)
        break
      case MutationTypes.UPLOAD_FILE:
        return forward(mutation, result)
      default:
        throw new Error(`Unknown mutation type: ${mutation.mutationType}`)
    }
    return jsonapi.fromPouchResult(
      pouchRes,
      false,
      getDoctypeFromOperation(mutation)
    )
  }

  createDocument(mutation) {
    return this.dbMethod('post', mutation)
  }

  async updateDocument(mutation) {
    return this.dbMethod('put', mutation)
  }

  async deleteDocument(mutation) {
    return this.dbMethod('remove', mutation)
  }

  async dbMethod(method, mutation) {
    const doctype = getDoctypeFromOperation(mutation)
    const { document } = mutation
    const db = this.getPouch(doctype)
    const res = await db[method](sanitized(document))
    if (res.ok) {
      return parseMutationResult(document, res)
    } else {
      throw new Error('Coud not apply mutation')
    }
  }
}