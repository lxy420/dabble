// Chat panel — pure DOM factory, no net/ imports. Builds messages, typing
// indicator and file-transfer cards from plain payload objects, and wires
// user actions (send / send file / accept / decline) back through the
// callbacks handed in by main.js.

const URL_RE = /(https?:\/\/[^\s<>"']+)/g

function linkify(text) {
  const frag = document.createDocumentFragment()
  const parts = text.split(URL_RE)
  parts.forEach(part => {
    if (!part) return
    if (/^https?:\/\//.test(part)) {
      const a = document.createElement('a')
      a.href = part
      a.textContent = part
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      frag.appendChild(a)
    } else {
      frag.appendChild(document.createTextNode(part))
    }
  })
  return frag
}

function formatTime(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes
  let i = -1
  do {
    value /= 1024
    i++
  } while (value >= 1024 && i < units.length - 1)
  return `${value.toFixed(1)} ${units[i]}`
}

export function createChatPanel(rootEl, {onSend, onSendFile, onAcceptFile, onDeclineFile} = {}) {
  rootEl.textContent = ''

  const messagesEl = document.createElement('div')
  messagesEl.className = 'chat-messages'

  const typingEl = document.createElement('div')
  typingEl.className = 'chat-typing'
  typingEl.hidden = true

  const inputRow = document.createElement('div')
  inputRow.className = 'chat-input-row'

  const textInput = document.createElement('input')
  textInput.type = 'text'
  textInput.placeholder = 'Poruka...'
  textInput.autocomplete = 'off'

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.hidden = true

  const attachBtn = document.createElement('button')
  attachBtn.type = 'button'
  attachBtn.className = 'btn'
  attachBtn.title = 'Pošalji datoteku'
  attachBtn.textContent = '📎'

  const sendBtn = document.createElement('button')
  sendBtn.type = 'button'
  sendBtn.className = 'btn active'
  sendBtn.textContent = 'Pošalji'

  inputRow.appendChild(textInput)
  inputRow.appendChild(attachBtn)
  inputRow.appendChild(sendBtn)
  inputRow.appendChild(fileInput)

  rootEl.appendChild(messagesEl)
  rootEl.appendChild(typingEl)
  rootEl.appendChild(inputRow)

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function submitMessage() {
    const text = textInput.value.trim()
    if (!text) return
    onSend?.(text)
    textInput.value = ''
  }

  sendBtn.addEventListener('click', submitMessage)
  textInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitMessage()
  })

  attachBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files || []).forEach(file => onSendFile?.(file))
    fileInput.value = ''
  })

  // Drag & drop anywhere on the room screen opens the send-file flow.
  const dropZone = rootEl.closest('#room-screen') || document.body
  let dragDepth = 0

  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files')
  }

  dropZone.addEventListener('dragover', event => {
    if (!hasFiles(event)) return
    event.preventDefault()
  })
  dropZone.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth++
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dropZone.classList.remove('drag-over')
  })
  dropZone.addEventListener('drop', event => {
    if (!event.dataTransfer?.files?.length) return
    event.preventDefault()
    dragDepth = 0
    dropZone.classList.remove('drag-over')
    Array.from(event.dataTransfer.files).forEach(file => onSendFile?.(file))
  })

  function addMessage({name, text, ts, self}) {
    const msg = document.createElement('div')
    msg.className = self ? 'msg self' : 'msg'

    const author = document.createElement('div')
    author.className = 'msg-author'
    author.textContent = name

    const time = document.createElement('span')
    time.className = 'msg-time'
    time.textContent = formatTime(ts ?? Date.now())
    author.appendChild(time)

    const body = document.createElement('div')
    body.className = 'msg-body'
    body.appendChild(linkify(text))

    msg.appendChild(author)
    msg.appendChild(body)
    messagesEl.appendChild(msg)
    scrollToBottom()
  }

  function addNotice(text) {
    const notice = document.createElement('div')
    notice.className = 'msg-notice'
    notice.textContent = text
    messagesEl.appendChild(notice)
    scrollToBottom()
  }

  function setTyping(names) {
    if (!names || names.length === 0) {
      typingEl.hidden = true
      typingEl.textContent = ''
      return
    }
    typingEl.hidden = false
    if (names.length === 1) {
      typingEl.textContent = `${names[0]} kuca...`
    } else if (names.length === 2) {
      typingEl.textContent = `${names[0]} i ${names[1]} kucaju...`
    } else {
      typingEl.textContent = `${names[0]}, ${names[1]} i još ${names.length - 2} kucaju...`
    }
  }

  function addFileCard({offerId, peerId, name, size, direction, incoming}) {
    const card = document.createElement('div')
    card.className = 'file-card'
    card.dataset.offerId = offerId

    const info = document.createElement('div')
    info.className = 'file-card-info'

    const nameEl = document.createElement('span')
    nameEl.className = 'file-card-name'
    nameEl.textContent = name

    const sizeEl = document.createElement('span')
    sizeEl.className = 'file-card-size'
    sizeEl.textContent = formatSize(size)

    info.appendChild(nameEl)
    info.appendChild(sizeEl)

    const status = document.createElement('div')
    status.className = 'file-card-status'
    status.textContent = incoming ? 'Nova datoteka' : 'Čeka prihvatanje...'

    const progress = document.createElement('progress')
    progress.max = 100
    progress.value = 0
    progress.hidden = true

    const actions = document.createElement('div')
    actions.className = 'file-card-actions'

    card.appendChild(info)
    card.appendChild(status)
    card.appendChild(progress)
    card.appendChild(actions)
    messagesEl.appendChild(card)
    scrollToBottom()

    function clearActions() {
      actions.textContent = ''
    }

    function setDeclined() {
      progress.hidden = true
      clearActions()
      status.textContent = 'Odbijeno'
    }

    if (incoming) {
      const acceptBtn = document.createElement('button')
      acceptBtn.type = 'button'
      acceptBtn.className = 'btn active'
      acceptBtn.textContent = 'Prihvati'

      const declineBtn = document.createElement('button')
      declineBtn.type = 'button'
      declineBtn.className = 'btn'
      declineBtn.textContent = 'Odbij'

      acceptBtn.addEventListener('click', () => {
        clearActions()
        status.textContent = direction === 'up' ? 'Slanje...' : 'Preuzimanje...'
        progress.hidden = false
        onAcceptFile?.(peerId, offerId)
      })
      declineBtn.addEventListener('click', () => {
        onDeclineFile?.(peerId, offerId)
        setDeclined()
      })

      actions.appendChild(acceptBtn)
      actions.appendChild(declineBtn)
    }

    function setProgress(pct) {
      progress.hidden = false
      progress.value = pct
      status.textContent = `${direction === 'up' ? 'Slanje' : 'Preuzimanje'}... ${Math.round(pct)}%`
    }

    function setDone(blobUrl) {
      progress.hidden = true
      clearActions()
      if (blobUrl) {
        status.textContent = 'Završeno'
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = name
        link.className = 'btn active'
        link.textContent = 'Sačuvaj'
        actions.appendChild(link)
      } else {
        status.textContent = 'Poslato'
      }
    }

    return {setProgress, setDone, setDeclined}
  }

  return {addMessage, addNotice, setTyping, addFileCard}
}
