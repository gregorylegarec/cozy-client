import CozyPouchFallbackLink from './CozyPouchFallbackLink'
import CozyClient, { CozyLink } from 'cozy-client'

const APPS_FIXTURES = [
  { _id: 'io.cozy.apps/notes', _type: 'io.cozy.apps', name: 'Notes', slug: 'notes'},
  { _id: 'io.cozy.apps/photos', _type: 'io.cozy.apps', name: 'Photos', slug: 'photos'}
]

const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn()
}

describe('CozyPouchFallbackLink', () => {
  describe('End to end', () => {
    const cozyPouchFallbackLink = new CozyPouchFallbackLink({
      doctypes: ['io.cozy.konnectors', 'io.cozy.apps']
    })

    jest.spyOn(cozyPouchFallbackLink, 'getStorage').mockReturnValue(localStorageMock)

    const requestHandler = jest.fn().mockResolvedValue({data: APPS_FIXTURES})
    const mockedLink = new CozyLink(requestHandler)

    const client = new CozyClient({
      links: [cozyPouchFallbackLink, mockedLink]
    })

    const expectedStoredValue = JSON.stringify({
      'io.cozy.apps': [[{doctype: 'io.cozy.apps'}, {data: APPS_FIXTURES}]]
    })

    it('should store response', async () => {
      await client.query(client.all('io.cozy.apps'))

      expect(localStorageMock.setItem).toHaveBeenCalledWith('_cozy_offline', expectedStoredValue)
    })

    it('should return stored response', async () => {
      jest.spyOn(cozyPouchFallbackLink, '_isOnline').mockReturnValue(false)
      localStorageMock.getItem.mockReturnValue(expectedStoredValue)

      const response = await client.query(client.all('io.cozy.apps'))

      expect(localStorageMock.getItem).toHaveBeenCalledWith('_cozy_offline')
      expect(response).toEqual({ data: APPS_FIXTURES})
    })

    it('should ignore unhandled doctype', async () => {
      await client.query(client.all('io.cozy.todos'))
      expect(requestHandler).toHaveBeenCalled()
    })

    it('should update existing response', async () => {
      cozyPouchFallbackLink._isOnline.mockReturnValue(true)

      const expectedNewResponse = { data: [APPS_FIXTURES[0]]}

      requestHandler.mockResolvedValue(expectedNewResponse)

      await client.query(client.all('io.cozy.apps'))

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        '_cozy_offline',
        JSON.stringify({
          'io.cozy.apps': [[{doctype: 'io.cozy.apps'}, expectedNewResponse]]}))
    })
  })
})
