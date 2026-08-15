import React from 'react'
import { useState } from 'react'

export default function Hero({ name, setName, onEnter, canScroll }) {
  const [error, setError] = useState('')

  const submit = (event) => {
    event.preventDefault()
    const isValid = onEnter()

    if (!isValid) {
      setError('Введите имя, чтобы продолжить')
      return
    }

    setError('')
  }

  const updateName = (event) => {
    setName(event.target.value)
    if (error && event.target.value.trim()) setError('')
  }

  return (
    <section className="hero">
      <div className="hero__shade" />
      <header className="hero__header">
        <span className="monogram">И&А</span>
        <span className="hero__date">06 · 09 · 2026</span>
      </header>

      <div className="hero__content">
        <p className="eyebrow">Наша свадебная история</p>
        <h1>Илья <i>&</i> Анна</h1>
        <p className="hero__copy">Смотрите фотографии, сохраняйте любимые кадры и делитесь своими.</p>

        <form className="guest-form" onSubmit={submit} noValidate>
          <label htmlFor="guest-name">Как вас зовут?</label>
          <div className={`guest-form__control${error ? ' has-error' : ''}`}>
            <input
              id="guest-name"
              value={name}
              onChange={updateName}
              placeholder="Введите имя"
              autoComplete="name"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'guest-name-error' : undefined}
            />
            <button type="submit" aria-label="Перейти в галерею">
              <span aria-hidden="true">→</span>
            </button>
          </div>
          {error && <p className="guest-form__error" id="guest-name-error" role="alert">{error}</p>}
        </form>
      </div>
      <div className="hero__scroll">{canScroll ? 'Листайте вниз' : 'Введите имя, чтобы продолжить'}</div>
    </section>
  )
}
