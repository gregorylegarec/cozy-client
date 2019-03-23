import HasMany from './HasMany'

const TRIGGERS_DOCTYPE = 'io.cozy.triggers'

/**
 * Association used for konnectors to retrieve all their related triggers.
 * @extends HasMany
 */
class HasManyTriggers extends HasMany {
  get data() {
    return super.data.filter(
      ({ message }) => message.konnector === this.target.slug
    )
  }

  /**
   * In this association the query is special, we need to fetch all the triggers
   * having for the 'konnector' worker, and then filter them based on their
   * `message.konnector` attribute
   */
  static query(doc, client) {
    return client.all(TRIGGERS_DOCTYPE).where({ worker: 'konnector' })
  }

  static isForced() {
    return true
  }
}

export default HasManyTriggers
