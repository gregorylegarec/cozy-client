import pick from 'lodash/pick'

import {
  SCHEMA,
  APP_NAME,
  APP_VERSION,
  SOURCE_ACCOUNT_ID
} from './__tests__/fixtures'

import CozyClient from './CozyClient'
import CozyLink from './CozyLink'
import { QueryDefinition } from './queries/dsl'
import { HasMany, HasManyInPlace, HasManyTriggers } from './associations'

describe('CozyClient', () => {
  const requestHandler = jest.fn()
  const link = new CozyLink(requestHandler)

  afterAll(() => {
    jest.restoreAllMocks()
  })

  let client
  beforeEach(() => {
    client = new CozyClient({
      links: [link],
      schema: SCHEMA,
      appMetadata: {
        slug: APP_NAME,
        sourceAccount: SOURCE_ACCOUNT_ID,
        version: APP_VERSION
      }
    })
    client.ensureStore()
    jest.spyOn(client.store, 'dispatch').mockImplementation(() => {})
  })

  afterEach(() => {
    requestHandler.mockReset()
  })

  describe('fetchRelationships', () => {
    describe('End to end examples', () => {
      const docToRelationshipData = doc => pick(doc, ['_id', '_type'])

      const albums = [
        { _type: 'io.cozy.photos.albums', _id: '12b21c69e8a341fa' },
        { _type: 'io.cozy.photos.albums', _id: 'ba0ad3039fd307b4' },
        { _type: 'io.cozy.photos.albums', _id: '18d4d5a7f46a48d6' }
      ]

      const foos = [{ _type: 'io.cozy.foos', _id: '0009c488a62146c' }]

      const files = [
        {
          _type: 'io.cozy.files',
          _id: '647acd5a1e634279',
          relationships: {
            referenced_by: {
              data: [albums[0], albums[2], foos[0]].map(docToRelationshipData)
            }
          }
        },
        {
          _type: 'io.cozy.files',
          _id: '9abb0ac09be3e203',
          relationships: {
            referenced_by: {
              data: [albums[1]].map(docToRelationshipData)
            }
          }
        },
        {
          _type: 'io.cozy.files',
          _id: '11a7243efd3967c1'
        }
      ]

      const konnectors = [
        {
          _id: 'io.cozy.konnectors/trains',
          _type: 'io.cozy.konnectors',
          name: 'Trains',
          slug: 'trains'
        },
        {
          _id: 'io.cozy.konnectors/money',
          _type: 'io.cozy.konnectors',
          name: 'Money',
          slug: 'money'
        },
        {
          _id: 'io.cozy.konnectors/health',
          _type: 'io.cozy.konnectors',
          name: 'Health',
          slug: 'health'
        }
      ]

      const triggers = [
        {
          _id: '17aac7d591784e02',
          _type: 'io.cozy.triggers',
          message: {
            konnector: 'trains'
          }
        },
        {
          _id: 'ba0005e5e53f158c',
          _type: 'io.cozy.triggers',
          message: {
            konnector: 'trains'
          }
        },
        {
          _id: '6cc19ec2e0e1414b',
          _type: 'io.cozy.triggers',
          message: {
            konnector: 'health'
          }
        }
      ]

      const fixtures = albums.concat(files, foos, konnectors, triggers)

      beforeEach(() => {
        requestHandler.mockImplementation(queryDefinition => {
          const data = fixtures
            .filter(doc => doc._type === queryDefinition.doctype)
            .filter(
              doc =>
                !queryDefinition.ids || queryDefinition.ids.includes(doc._id)
            )
            .filter(
              doc => !queryDefinition.id || doc._id === queryDefinition.id
            )

          return { data: data.length === 1 ? data[0] : data }
        })
      })

      describe('Photo albums', () => {
        it('should fetch photo albums', async () => {
          class HasManyReferenced extends HasMany {
            get data() {
              const refs = this.target.relationships.referenced_by.data.filter(
                ref => ref._type === this.doctype
              )
              return refs
                ? refs.map(ref => this.get(ref._type, ref._id)).filter(Boolean)
                : []
            }

            static query(doc, client, assoc) {
              if (
                !doc.relationships ||
                !doc.relationships.referenced_by ||
                !doc.relationships.referenced_by.data
              ) {
                return null
              }
              const included = doc['relationships']['referenced_by']['data']
              const ids = included
                .filter(inc => inc._type === assoc.doctype)
                .map(inc => inc._id)

              return new QueryDefinition({ doctype: assoc.doctype, ids })
            }
          }

          const schema = {
            albums: {
              doctype: 'io.cozy.photos.albums'
            },
            foos: {
              doctype: 'io.cozy.foos'
            },
            files: {
              doctype: 'io.cozy.files',
              relationships: {
                albums: {
                  type: HasManyReferenced,
                  doctype: 'io.cozy.photos.albums',
                  inverted: true
                },
                foos: {
                  type: HasManyReferenced,
                  doctype: 'io.cozy.foos',
                  inverted: true
                }
              }
            }
          }

          const client = new CozyClient({
            links: [link],
            schema
          })

          const query = new QueryDefinition({
            doctype: 'io.cozy.files',
            limit: 50,
            selector: {
              class: 'image',
              trashed: false
            }
          }).include(['albums', 'foos'])

          const resp = await client.query(query)

          expect(resp.data).toEqual([
            {
              _type: 'io.cozy.files',
              _id: '647acd5a1e634279',
              relationships: {
                referenced_by: {
                  data: [albums[0], albums[2], foos[0]].map(
                    docToRelationshipData
                  )
                }
              }
            },
            {
              _type: 'io.cozy.files',
              _id: '9abb0ac09be3e203',
              relationships: {
                referenced_by: { data: [albums[1]].map(docToRelationshipData) }
              }
            },
            {
              _type: 'io.cozy.files',
              _id: '11a7243efd3967c1',
              relationships: {}
            }
          ])
          expect(resp.included).toEqual(albums.concat(foos))
          const hydratedfiles = client.hydrateDocuments(
            'io.cozy.files',
            resp.data
          )
          expect(hydratedfiles[0].albums.data).toEqual([albums[0], albums[2]])
        })
      })

      describe('Bills', async () => {
        class HasManyBills extends HasManyInPlace {
          get data() {
            return this.raw
              ? this.raw.map(doctypeId => {
                  const [doctype, id] = doctypeId.split(':')
                  return this.get(doctype, id)
                })
              : []
          }

          static query(doc, client, assoc) {
            if (!doc[assoc.name]) {
              return null
            }
            const included = doc[assoc.name]
            const ids = included.indexOf(':')
              ? included.map(x => x.split(':')[1])
              : included

            return new QueryDefinition({ doctype: assoc.doctype, ids })
          }
        }

        const schema = {
          transactions: {
            doctype: 'io.cozy.bank.operations',
            attributes: {},
            relationships: {
              bills: {
                type: HasManyBills,
                doctype: 'io.cozy.bills'
              }
            }
          }
        }

        const client = new CozyClient({
          links: [link],
          schema
        })

        const query = new QueryDefinition({
          doctype: 'io.cozy.bank.operations',
          limit: 500,
          selector: {
            bills: {
              $exists: true
            }
          }
        }).include(['bills'])

        const resp = await client.query(query)

        const transactions = client
          .hydrateDocuments('io.cozy.bank.operations', resp.data)
          .filter(tr => tr.bills && tr.bills.data.length > 0)

        transactions.forEach(transaction => {
          expect(transaction.bills.data[0]).toBeDefined()
        })
      })

      describe('Konnector triggers', () => {
        it('should fetch triggers', async () => {
          const schema = {
            konnectors: {
              doctype: 'io.cozy.konnectors',
              relationships: {
                triggers: {
                  type: HasManyTriggers,
                  doctype: 'io.cozy.triggers'
                }
              }
            },
            triggers: {
              doctype: 'io.cozy.triggers'
            }
          }

          const client = new CozyClient({
            links: [link],
            schema
          })

          const query = new QueryDefinition({
            doctype: 'io.cozy.konnectors'
          }).include(['triggers'])

          const resp = await client.query(query)

          expect(resp.data).toEqual([
            {
              _id: 'io.cozy.konnectors/trains',
              _type: 'io.cozy.konnectors',
              name: 'Trains',
              slug: 'trains',
              relationships: {
                triggers: {
                  data: triggers.map(t => pick(t, ['_id', '_type']))
                }
              }
            },
            {
              _id: 'io.cozy.konnectors/money',
              _type: 'io.cozy.konnectors',
              name: 'Money',
              slug: 'money',
              relationships: {
                triggers: {
                  data: triggers.map(t => pick(t, ['_id', '_type']))
                }
              }
            },
            {
              _id: 'io.cozy.konnectors/health',
              _type: 'io.cozy.konnectors',
              name: 'Health',
              slug: 'health',
              relationships: {
                triggers: {
                  data: triggers.map(t => pick(t, ['_id', '_type']))
                }
              }
            }
          ])

          expect(resp.included).toEqual(triggers)

          const hydratedKonnectors = client.hydrateDocuments(
            'io.cozy.konnectors',
            resp.data
          )
          expect(hydratedKonnectors[0].triggers.data).toEqual([
            triggers[0],
            triggers[1]
          ])
        })
      })
    })
  })
})
