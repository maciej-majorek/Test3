import { useEffect, useState } from 'react'
import './App.css'

const AZURE_OPENAI_ENDPOINT = 'https://ai-proxy.lab.epam.com'
const AZURE_OPENAI_API_KEY = 'dial-m4dc71i4w0ybgagngx2c9u34qm0'
const AZURE_OPENAI_API_VERSION = '2024-02-01'
const AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-mini-2024-07-18'

async function getPolishCitySuggestions(query) {
  if (!query || query.length < 2) return []

  const response = await fetch(
    `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You return only a concise comma-separated list of real city names in Poland that start with or closely match the user input. No explanations, no extra text.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.2,
        max_tokens: 64,
      }),
    }
  )

  if (!response.ok) {
    console.error('Azure OpenAI error', await response.text())
    return []
  }

  const data = await response.json()
  const raw = data.choices?.[0]?.message?.content || ''

  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 5)
}

function getConditionLevel(conditions) {
  const text = (conditions || '').toLowerCase()
  if (!text) return 'unknown'

  if (
    text.includes('excellent') ||
    text.includes('very good') ||
    text.includes('powder') ||
    text.includes('fresh')
  ) {
    return 'good'
  }

  if (
    text.includes('good') ||
    text.includes('ok') ||
    text.includes('fair') ||
    text.includes('decent')
  ) {
    return 'fair'
  }

  if (
    text.includes('poor') ||
    text.includes('bad') ||
    text.includes('slush') ||
    text.includes('icy') ||
    text.includes('closed')
  ) {
    return 'bad'
  }

  return 'unknown'
}

async function getSkiConditionsForCity(city, rangeKm) {
  if (!city) return { slopes: [], raw: '', error: '' }

  const response = await fetch(
    `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You are a ski and weather assistant. Respond ONLY with a valid raw JSON array, no markdown, no explanation, and do NOT prepend the word "json". The response must start with "[" and end with "]". Each array element is an object with keys: "name", "status", "conditions", "snowDepth", "url". "status" is a short word like "open", "closed", "partial", or "unknown". "snowDepth" is a short string like "60 cm" or "unknown". "url" is a direct link to an official or reliable ski information page if known, otherwise an empty string.',
          },
          {
            role: 'user',
            content: `City: ${city}. List ski slopes within about ${rangeKm} km in Poland and return them as a JSON array with fields: name, status, conditions, snowDepth, url.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 220,
      }),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    console.error('Azure OpenAI error (ski conditions)', text)
    throw new Error('Failed to fetch ski conditions')
  }

  const data = await response.json()
  let raw = (data.choices?.[0]?.message?.content || '').trim()

  // Strip common markdown wrappers like ```json ... ```
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim()
  }

  // Strip a leading "json" token if the model added it
  if (raw.toLowerCase().startsWith('json')) {
    raw = raw.slice(4).trim()
  }

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { slopes: parsed, raw, error: '' }
    }
    console.error('Unexpected ski conditions format (not array)', parsed)
    return {
      slopes: [],
      raw,
      error: 'Unexpected JSON structure (expected an array of slopes).',
    }
  } catch (err) {
    console.error('Failed to parse ski conditions JSON', err, raw)
    return {
      slopes: [],
      raw,
      error: 'Failed to parse JSON from AI response.',
    }
  }
}

function App() {
  const [city, setCity] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSelectedCity, setHasSelectedCity] = useState(false)
  const [slopes, setSlopes] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [rangeKm, setRangeKm] = useState('100')
  const [usedRangeKm, setUsedRangeKm] = useState(100)
  const [rawJsonDebug, setRawJsonDebug] = useState('')
  const [email, setEmail] = useState('')
  const [subscribeMessage, setSubscribeMessage] = useState('')

  // Validation for subscribe button
  const isValidEmail = (email) => {
    const trimmed = (email || '').trim()
    if (!trimmed) return false
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    return emailRegex.test(trimmed)
  }
  const canSubscribe = hasSelectedCity && isValidEmail(email)

  useEffect(() => {
    if (hasSelectedCity) {
      // After a city is chosen, keep dropdown hidden until user edits again
      setSuggestions([])
      setError('')
      return
    }

    if (city.trim().length < 2) {
      setSuggestions([])
      setError('')
      return
    }

    let cancelled = false
    const timeoutId = setTimeout(async () => {
      setIsLoading(true)
      try {
        const result = await getPolishCitySuggestions(city.trim())
        if (!cancelled) {
          setSuggestions(result)
          setError('')
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setError('Could not load city suggestions.')
          setSuggestions([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [city, hasSelectedCity])

  const handleSelectSuggestion = (value) => {
    setCity(value)
    setSuggestions([])
    setHasSelectedCity(true)
  }

  const handleSearch = async () => {
    const trimmedCity = city.trim()
    if (!trimmedCity) {
      setSearchError('Please choose a city first.')
      setSlopes([])
      return
    }

    const parsedRange = parseInt(rangeKm, 10)
    const effectiveRange =
      Number.isFinite(parsedRange) && parsedRange > 0 ? parsedRange : 100

    setIsSearching(true)
    setSearchError('')
    setSlopes([])
    setRawJsonDebug('')
    setUsedRangeKm(effectiveRange)

    try {
      const { slopes: resultSlopes, raw, error } =
        await getSkiConditionsForCity(trimmedCity, effectiveRange)

      if (error) {
        setSearchError('AI returned invalid ski-slope JSON.')
        setRawJsonDebug(raw || 'No content returned from AI.')
        setSlopes([])
        return
      }

      if (!Array.isArray(resultSlopes) || resultSlopes.length === 0) {
        setSearchError('No ski slope data found near this city. Please try another.')
        setRawJsonDebug(raw || '')
        setSlopes([])
        return
      }

      setSlopes(resultSlopes)
      setRawJsonDebug('')
    } catch (e) {
      console.error(e)
      setSearchError('Could not load ski conditions. Please try again.')
      setSlopes([])
      setRawJsonDebug('')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSubscribe = () => {
    const trimmed = (email || '').trim()
    if (!trimmed) {
      setSubscribeMessage('Please enter an email address.')
      return
    }

    // Email format validation (simple RFC 5322 compliant regex)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    if (!emailRegex.test(trimmed)) {
      setSubscribeMessage('Please enter a valid email address.')
      return
    }

    setSubscribeMessage('Thanks for subscribing!')
    setEmail('')
    setTimeout(() => setSubscribeMessage(''), 4000)
  }

  return (
    <div className="page">
      <main>
        <section className="hero">
          <div className="hero-content">
            <h1>Current ski conditions in your area</h1>
            <p className="subtitle">
              Enter a city name and click search.
            </p>
            <div className="hero-actions">
              <div className="city-input-wrapper">
                <label>
                  City:{' '}
                  <input
                    type="text"
                    name="city"
                    placeholder="e.g. Zakopane"
                    className="subscribe-input"
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value)
                      setHasSelectedCity(false)
                    }}
                    autoComplete="off"
                  />
                </label>

                <div className="city-dropdown">
                  {!hasSelectedCity && isLoading && (
                    <div className="city-dropdown-status">Loading city hints…</div>
                  )}
                  {!hasSelectedCity && error && (
                    <div className="city-dropdown-error">{error}</div>
                  )}
                  {!hasSelectedCity && !isLoading && !error && suggestions.length > 0 && (
                    <ul className="city-dropdown-list">
                      {suggestions.map((s) => (
                        <li
                          key={s}
                          className="city-dropdown-item"
                          onClick={() => handleSelectSuggestion(s)}
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="range-input-wrapper">
                <label>
                  Range (km){' '}
                  <input
                    type="number"
                    min="10"
                    max="300"
                    step="10"
                    className="subscribe-input"
                    value={rangeKm}
                    onChange={(e) => setRangeKm(e.target.value)}
                  />
                </label>
              </div>

              <button className="btn btn-primary" onClick={handleSearch}>
                {isSearching ? 'Searching…' : 'Search'}
              </button>

              <div className="subscribe-wrapper" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', width: '100%', alignItems: 'center' }}>
                  <input
                    className="subscribe-input"
                    type="email"
                    placeholder="Your email"
                    aria-label="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleSubscribe} disabled={!canSubscribe}>
                    Subscribe
                  </button>
                  {subscribeMessage && (
                    <span className="subscribe-inline-message" style={{ marginLeft: '0.8rem', background: '#22c55e', color: '#fff', borderRadius: '0.7rem', padding: '0.45rem 1.1rem', fontSize: '0.98rem', fontWeight: 500, animation: 'fadeout 0.5s 4.5s forwards', whiteSpace: 'nowrap' }}>{subscribeMessage}</span>
                  )}
                </div>
              </div>
            </div>
            {searchError && (
              <p className="conditions-error">{searchError}</p>
            )}
            {rawJsonDebug && (
              <pre className="raw-json-debug">
                {rawJsonDebug}
              </pre>
            )}
            {slopes.length > 0 && !searchError && (
              <div className="conditions-card">
                <h2>Ski slopes within {usedRangeKm} km of {city}</h2>
                <table className="slopes-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Conditions</th>
                      <th>Snow depth</th>
                      <th>Website</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slopes.map((slope, index) => (
                      <tr key={slope.url || slope.name || index}>
                        <td>{slope.name || 'Unknown'}</td>
                        <td>{slope.status || 'Unknown'}</td>
                        <td>
                          <span
                            className={`condition-icon condition-icon-${getConditionLevel(
                              slope.conditions
                            )}`}
                            aria-hidden="true"
                          />
                          <span className="condition-text">
                            {slope.conditions || '—'}
                          </span>
                        </td>
                        <td>{slope.snowDepth || 'Unknown'}</td>
                        <td>
                          {slope.url ? (
                            <a href={slope.url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
