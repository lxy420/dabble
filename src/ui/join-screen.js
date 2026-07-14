// Join screen — pure DOM factory, no net/ imports. Renders into the fixed
// #join-screen element from the Task 1 index.html contract.

const NAME_STORAGE_KEY = 'dabble-name'

function readHashCode() {
  const raw = location.hash.replace(/^#/, '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    // Malformed percent-encoding (e.g. "#abc%") — treat as no prefill
    // instead of letting the throw blank the whole join screen.
    return ''
  }
}

export function renderJoinScreen({onJoin, generateCode} = {}) {
  const root = document.getElementById('join-screen')
  root.textContent = ''

  const card = document.createElement('div')
  card.className = 'join-card'

  const title = document.createElement('h1')
  title.className = 'app-title'
  title.textContent = 'dabble'
  card.appendChild(title)

  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.placeholder = 'tvoje ime'
  nameInput.autocomplete = 'off'
  nameInput.value = localStorage.getItem(NAME_STORAGE_KEY) || ''
  card.appendChild(nameInput)

  const codeInput = document.createElement('input')
  codeInput.type = 'text'
  codeInput.placeholder = 'kod sobe'
  codeInput.autocomplete = 'off'
  codeInput.value = readHashCode()
  card.appendChild(codeInput)

  const actions = document.createElement('div')
  actions.className = 'join-actions'

  const joinBtn = document.createElement('button')
  joinBtn.type = 'button'
  joinBtn.className = 'btn active'
  joinBtn.textContent = 'Upadni'

  const createBtn = document.createElement('button')
  createBtn.type = 'button'
  createBtn.className = 'btn'
  createBtn.textContent = 'Napravi sobu'

  actions.appendChild(joinBtn)
  actions.appendChild(createBtn)
  card.appendChild(actions)

  root.appendChild(card)

  nameInput.addEventListener('input', () => {
    localStorage.setItem(NAME_STORAGE_KEY, nameInput.value)
  })

  function submitJoin() {
    const name = nameInput.value.trim()
    const code = codeInput.value.trim()
    if (!name) {
      nameInput.focus()
      return
    }
    if (!code) {
      codeInput.focus()
      return
    }
    localStorage.setItem(NAME_STORAGE_KEY, name)
    location.hash = code
    onJoin?.({name, code})
  }

  joinBtn.addEventListener('click', submitJoin)

  ;[nameInput, codeInput].forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') submitJoin()
    })
  })

  createBtn.addEventListener('click', () => {
    const code = generateCode?.()
    if (code) {
      codeInput.value = code
      codeInput.focus()
    }
  })
}
