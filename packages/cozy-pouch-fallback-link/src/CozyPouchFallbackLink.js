import { CozyLink } from 'cozy-client'
import pickBy from 'lodash/pickBy'
import isEqual from 'lodash/isEqual'

export class CozyPouchFallbackLink extends CozyLink {
  constructor({ doctypes }) {
    super()
    this.doctypes = doctypes
  }

  getStorage() {
    return localStorage
  }

  _isOnline() {
    return navigator && navigator.onLine
  }

  request(operation, result, forward) {
    if (!this.doctypes.includes(operation.doctype)) {
      return forward(operation)
    }

    if (this._isOnline()) {
      const responsePromise = forward(operation)
      this._savePromisedResponse(operation, responsePromise)
      return responsePromise
    }

    return this._getResponse(operation) || { data: [] }
  }

  async _savePromisedResponse(operation, responsePromise) {
    this._saveResponse(operation, await responsePromise)
  }

  _saveResponse(operation, response) {
    const { doctype } = operation
    const responses = this._getResponsesFromStorage(doctype)
    const existingResponse = this._getResponse(operation)

    if (existingResponse) {
      const existingResponseIndex = responses.indexOf(existingResponse)
      responses.splice(existingResponseIndex, 1)
    }

    responses.push([operation, response])
    this._saveResponsesToStorage(doctype, responses)
  }

  _getResponse(operation) {
    const { doctype } = operation
    const responses = this._getResponsesFromStorage(doctype)
    const existingResponse = responses.find(response =>
      isEqual(response[0], pickBy(operation))
    )
    return existingResponse && existingResponse[1]
  }

  _getStorageData() {
    if (!this._cachedStorageData) {
      // Cache to avoid multiple calls to JSON.parse
      const storageData = this.getStorage().getItem('_cozy_offline')
      this._cachedStorageData = storageData ? JSON.parse(storageData) : {}
    }
    return this._cachedStorageData
  }

  _getResponsesFromStorage(doctype) {
    const stored = this._getStorageData()
    return stored[doctype] || []
  }

  _saveResponsesToStorage(doctype, responses) {
    const stored = this._getStorageData()
    const data = {
      ...stored,
      [doctype]: responses
    }

    this.getStorage().setItem('_cozy_offline', JSON.stringify(data))
    this._cachedStorageData = null
  }
}

export default CozyPouchFallbackLink
