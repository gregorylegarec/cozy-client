jest.mock('../CozyClient')

import React, { Component } from 'react'
import configureStore from 'redux-mock-store'
import { shallow } from 'enzyme'

import Provider from '../Provider'
import CozyClient from '../CozyClient'

describe('Provider', () => {
  const client = new CozyClient()
  const store = configureStore()({})

  it('should renders children when passed in', () => {
    const wrapper = shallow(
      <Provider client={client} store={store}>
        <div className="unique" />
      </Provider>
    )
    expect(wrapper.contains(<div className="unique" />)).toBe(true)
  })

  it('should provide the client in the context', () => {
    class FakeComponent extends Component {
      onClick = () => {
        this.context.client.query('foo')
      }
      render() {
        return <button onClick={this.onClick} />
      }
    }
    const wrapper = shallow(
      <Provider client={client} store={store}>
        <FakeComponent />
      </Provider>
    )
    wrapper
      .dive({ context: { client } }) // because of https://github.com/airbnb/enzyme/issues/664... This defeats a bit the purpose of the test...
      .find('button')
      .simulate('click')
    expect(client.query).toHaveBeenCalledWith('foo')
  })
})