import { useState, useEffect, useRef, useCallback } from 'react'
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured } from './firebase'
import './App.css'

const BOARD_WIDTH = 10
const BOARD_HEIGHT = 20

// 테트로미노 7종 정의
const TETROMINOES = {
  I: {
    type: 'I',
    name: 'I 블록 (하늘)',
    matrix: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  },
  O: {
    type: 'O',
    name: 'O 블록 (노랑)',
    matrix: [
      [1, 1],
      [1, 1],
    ],
  },
  T: {
    type: 'T',
    name: 'T 블록 (보라)',
    matrix: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  S: {
    type: 'S',
    name: 'S 블록 (초록)',
    matrix: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
  },
  Z: {
    type: 'Z',
    name: 'Z 블록 (빨강)',
    matrix: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
  },
  J: {
    type: 'J',
    name: 'J 블록 (파랑)',
    matrix: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  L: {
    type: 'L',
    name: 'L 블록 (주황)',
    matrix: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
}

const PIECE_TYPES = Object.keys(TETROMINOES)

// 줄 삭제 점수 배율 (1줄, 2줄, 3줄, 4줄)
const LINE_CLEAR_POINTS = [0, 100, 300, 500, 800]

// 빈 10x20 보드 생성
function createEmptyBoard() {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null))
}

// 7-Bag 무작위 섞기
function createShuffledBag() {
  const bag = [...PIECE_TYPES]
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

// 블록 객체 생성
function createPiece(type) {
  const template = TETROMINOES[type]
  const matrix = template.matrix.map((row) => [...row])
  const x = Math.floor((BOARD_WIDTH - matrix[0].length) / 2)
  const y = 0
  return {
    type: template.type,
    name: template.name,
    matrix,
    x,
    y,
  }
}

// 시계 방향 90도 회전
function rotateMatrixCW(matrix) {
  return matrix[0].map((_, colIndex) =>
    matrix.map((row) => row[colIndex]).reverse()
  )
}

// 충돌 검사
function isValidPosition(board, matrix, targetX, targetY) {
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (!matrix[r][c]) continue
      const newX = targetX + c
      const newY = targetY + r

      if (newX < 0 || newX >= BOARD_WIDTH || newY >= BOARD_HEIGHT) {
        return false
      }
      if (newY >= 0 && board[newY][newX] !== null) {
        return false
      }
    }
  }
  return true
}

// 레벨별 낙하 간격(ms) 계산: 레벨이 오를수록 빨라짐
function getDropInterval(level) {
  return Math.max(90, Math.round(1000 * Math.pow(0.84, level - 1)))
}

// 초기 게임 상태 생성
function createInitialGameState(status = 'idle') {
  const bag = createShuffledBag()
  const firstType = bag.pop()
  const secondType = bag.pop()

  return {
    board: createEmptyBoard(),
    currentPiece: createPiece(firstType),
    nextPiece: createPiece(secondType),
    bag,
    score: 0,
    lines: 0,
    level: 1,
    status, // 'idle' | 'playing' | 'paused' | 'gameover'
  }
}

// Firebase Auth 오류 코드를 한국어 안내 메시지로 변환
function getKoreanAuthErrorMessage(error) {
  const code = error?.code || ''
  switch (code) {
    case 'auth/popup-closed-by-user':
      return '로그인 창이 닫혀 Google 로그인이 취소되었습니다.'
    case 'auth/cancelled-popup-request':
      return '진행 중인 로그인 요청이 취소되었습니다. 다시 시도해 주세요.'
    case 'auth/popup-blocked':
      return '브라우저에서 로그인 팝업이 차단되었습니다. 팝업 차단을 해제한 뒤 다시 시도해 주세요.'
    case 'auth/unauthorized-domain':
      return '현재 접속 도메인이 Firebase 승인된 도메인(Authorized domains)에 등록되어 있지 않습니다.'
    case 'auth/operation-not-allowed':
      return 'Firebase 콘솔에서 Google 로그인 제공업체가 아직 활성화되지 않았습니다.'
    case 'auth/network-request-failed':
      return '네트워크 연결 오류가 발생했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'
    case 'auth/invalid-api-key':
      return 'Firebase API 키가 올바르지 않습니다. .env.local 환경변수 설정을 확인해 주세요.'
    default:
      return `Google 로그인 중 오류가 발생했습니다.${code ? ` (${code})` : ''}`
  }
}

export default function App() {
  const [game, setGame] = useState(() => createInitialGameState('idle'))
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [authMessage, setAuthMessage] = useState(null)

  const gameRef = useRef(game)
  gameRef.current = game

  const userRef = useRef(user)
  userRef.current = user

  // onAuthStateChanged로 로그인 상태 감지 및 새로고침 시 로그인 유지
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthLoading(false)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser)
        setAuthLoading(false)
        if (!currentUser) {
          // 로그아웃 시 진행 중이던 게임을 대기 상태로 초기화
          setGame((prev) =>
            prev.status === 'idle' ? prev : createInitialGameState('idle')
          )
        }
      },
      (error) => {
        console.error('인증 상태 확인 오류:', error)
        setAuthLoading(false)
        setAuthMessage({
          type: 'error',
          text: '로그인 상태를 확인하는 중 오류가 발생했습니다.',
        })
      }
    )

    return () => unsubscribe()
  }, [])

  // Google로 로그인 (GoogleAuthProvider + signInWithPopup)
  const handleGoogleLogin = useCallback(async () => {
    setAuthMessage(null)

    if (!isFirebaseConfigured || !auth || !googleProvider) {
      setAuthMessage({
        type: 'error',
        text: 'Firebase 웹앱 환경변수(.env.local)가 아직 설정되지 않았습니다. 설정 안내에 따라 환경변수를 입력해 주세요.',
      })
      return
    }

    setIsSigningIn(true)
    try {
      await signInWithPopup(auth, googleProvider)
      setAuthMessage(null)
    } catch (error) {
      console.error('Google 로그인 실패:', error)
      setAuthMessage({
        type: 'error',
        text: getKoreanAuthErrorMessage(error),
      })
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  // 로그아웃
  const handleLogout = useCallback(async () => {
    if (!auth) return
    try {
      await signOut(auth)
      setGame(createInitialGameState('idle'))
      setAuthMessage({
        type: 'info',
        text: '로그아웃되었습니다.',
      })
    } catch (error) {
      console.error('로그아웃 오류:', error)
      setAuthMessage({
        type: 'error',
        text: '로그아웃 처리 중 오류가 발생했습니다. 다시 시도해 주세요.',
      })
    }
  }, [])

  // 가방에서 다음 블록 뽑기
  const pullFromBag = (currentBag) => {
    const nextBag = currentBag.length > 0 ? [...currentBag] : createShuffledBag()
    const nextType = nextBag.pop()
    return { piece: createPiece(nextType), bag: nextBag }
  }

  // 블록을 보드에 고정하고 줄 삭제 및 다음 블록 스폰 처리
  const lockAndAdvance = useCallback((state, pieceToLock, bonusScore = 0) => {
    const nextBoard = state.board.map((row) => [...row])

    for (let r = 0; r < pieceToLock.matrix.length; r += 1) {
      for (let c = 0; c < pieceToLock.matrix[r].length; c += 1) {
        if (pieceToLock.matrix[r][c]) {
          const boardY = pieceToLock.y + r
          const boardX = pieceToLock.x + c
          if (boardY >= 0 && boardY < BOARD_HEIGHT && boardX >= 0 && boardX < BOARD_WIDTH) {
            nextBoard[boardY][boardX] = pieceToLock.type
          }
        }
      }
    }

    // 꽉 찬 줄 제거
    const remainingRows = nextBoard.filter((row) => row.some((cell) => cell === null))
    const clearedLines = BOARD_HEIGHT - remainingRows.length

    while (remainingRows.length < BOARD_HEIGHT) {
      remainingRows.unshift(Array(BOARD_WIDTH).fill(null))
    }

    const lineScore = (LINE_CLEAR_POINTS[clearedLines] || 0) * state.level
    const nextScore = state.score + bonusScore + lineScore
    const nextLines = state.lines + clearedLines
    const nextLevel = Math.floor(nextLines / 10) + 1

    const spawnedPiece = createPiece(state.nextPiece.type)
    const { piece: upcomingPiece, bag: updatedBag } = pullFromBag(state.bag)

    // 새로 스폰된 블록이 시작 위치에서 바로 충돌하면 게임 오버
    if (!isValidPosition(remainingRows, spawnedPiece.matrix, spawnedPiece.x, spawnedPiece.y)) {
      return {
        ...state,
        board: remainingRows,
        currentPiece: spawnedPiece,
        nextPiece: upcomingPiece,
        bag: updatedBag,
        score: nextScore,
        lines: nextLines,
        level: nextLevel,
        status: 'gameover',
      }
    }

    return {
      ...state,
      board: remainingRows,
      currentPiece: spawnedPiece,
      nextPiece: upcomingPiece,
      bag: updatedBag,
      score: nextScore,
      lines: nextLines,
      level: nextLevel,
    }
  }, [])

  // 좌우 이동
  const moveHorizontal = useCallback((dir) => {
    setGame((prev) => {
      if (prev.status !== 'playing' || !prev.currentPiece) return prev
      const nextX = prev.currentPiece.x + dir
      if (isValidPosition(prev.board, prev.currentPiece.matrix, nextX, prev.currentPiece.y)) {
        return {
          ...prev,
          currentPiece: { ...prev.currentPiece, x: nextX },
        }
      }
      return prev
    })
  }, [])

  // 블록 회전 (벽 차기 보정 포함)
  const rotatePiece = useCallback(() => {
    setGame((prev) => {
      if (prev.status !== 'playing' || !prev.currentPiece) return prev
      const rotated = rotateMatrixCW(prev.currentPiece.matrix)
      const kicks = [0, -1, 1, -2, 2]

      for (const offsetX of kicks) {
        const candidateX = prev.currentPiece.x + offsetX
        if (isValidPosition(prev.board, rotated, candidateX, prev.currentPiece.y)) {
          return {
            ...prev,
            currentPiece: {
              ...prev.currentPiece,
              matrix: rotated,
              x: candidateX,
            },
          }
        }
      }
      return prev
    })
  }, [])

  // 한 칸 아래로 이동 (자연 낙하 또는 빠르게 내리기)
  const stepDown = useCallback(
    (isSoftDrop = false) => {
      setGame((prev) => {
        if (prev.status !== 'playing' || !prev.currentPiece) return prev
        const nextY = prev.currentPiece.y + 1

        if (isValidPosition(prev.board, prev.currentPiece.matrix, prev.currentPiece.x, nextY)) {
          return {
            ...prev,
            score: isSoftDrop ? prev.score + 1 : prev.score,
            currentPiece: {
              ...prev.currentPiece,
              y: nextY,
            },
          }
        }

        return lockAndAdvance(prev, prev.currentPiece, 0)
      })
    },
    [lockAndAdvance]
  )

  // 즉시 떨어뜨리기 (하드 드롭)
  const hardDrop = useCallback(() => {
    setGame((prev) => {
      if (prev.status !== 'playing' || !prev.currentPiece) return prev
      let dropDistance = 0
      let targetY = prev.currentPiece.y

      while (
        isValidPosition(
          prev.board,
          prev.currentPiece.matrix,
          prev.currentPiece.x,
          targetY + 1
        )
      ) {
        targetY += 1
        dropDistance += 1
      }

      const droppedPiece = {
        ...prev.currentPiece,
        y: targetY,
      }

      return lockAndAdvance(prev, droppedPiece, dropDistance * 2)
    })
  }, [lockAndAdvance])

  // 시작 버튼 (로그인한 사용자만 시작 가능)
  const handleStart = useCallback(() => {
    if (!userRef.current) {
      setAuthMessage({
        type: 'error',
        text: '로그인한 사용자만 게임을 시작할 수 있습니다. 먼저 Google로 로그인해 주세요.',
      })
      return
    }

    setGame((prev) => {
      if (prev.status === 'idle' || prev.status === 'gameover') {
        return createInitialGameState('playing')
      }
      if (prev.status === 'paused') {
        return { ...prev, status: 'playing' }
      }
      return prev
    })
  }, [])

  // 일시정지 / 계속하기 토글
  const handleTogglePause = useCallback(() => {
    if (!userRef.current) return
    setGame((prev) => {
      if (prev.status === 'playing') {
        return { ...prev, status: 'paused' }
      }
      if (prev.status === 'paused') {
        return { ...prev, status: 'playing' }
      }
      return prev
    })
  }, [])

  // 다시 시작 버튼 (로그인한 사용자만 가능)
  const handleRestart = useCallback(() => {
    if (!userRef.current) {
      setAuthMessage({
        type: 'error',
        text: '로그인한 사용자만 게임을 시작할 수 있습니다. 먼저 Google로 로그인해 주세요.',
      })
      return
    }
    setGame(createInitialGameState('playing'))
  }, [])

  // 레벨에 따른 자동 낙하 타이머
  useEffect(() => {
    if (game.status !== 'playing' || !user) return undefined
    const intervalMs = getDropInterval(game.level)
    const timer = setInterval(() => {
      stepDown(false)
    }, intervalMs)

    return () => clearInterval(timer)
  }, [game.status, game.level, user, stepDown])

  // 키보드 조작 이벤트 등록
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!userRef.current) return
      const currentStatus = gameRef.current.status

      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (currentStatus === 'playing' || currentStatus === 'paused') {
          e.preventDefault()
          handleTogglePause()
        }
        return
      }

      if (currentStatus !== 'playing') return

      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          e.preventDefault()
          moveHorizontal(-1)
          break
        case 'ArrowRight':
        case 'KeyD':
          e.preventDefault()
          moveHorizontal(1)
          break
        case 'ArrowUp':
        case 'KeyW':
        case 'KeyX':
          e.preventDefault()
          rotatePiece()
          break
        case 'ArrowDown':
        case 'KeyS':
          e.preventDefault()
          stepDown(true)
          break
        case 'Space':
          e.preventDefault()
          hardDrop()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [moveHorizontal, rotatePiece, stepDown, hardDrop, handleTogglePause])

  // 화면 표시용 보드 합성 (고스트 블록 + 현재 떨어지는 블록)
  const displayBoard = game.board.map((row) => [...row])

  if (game.currentPiece && (game.status === 'playing' || game.status === 'paused')) {
    let ghostY = game.currentPiece.y
    while (
      isValidPosition(
        game.board,
        game.currentPiece.matrix,
        game.currentPiece.x,
        ghostY + 1
      )
    ) {
      ghostY += 1
    }

    // 고스트 블록 표시
    for (let r = 0; r < game.currentPiece.matrix.length; r += 1) {
      for (let c = 0; c < game.currentPiece.matrix[r].length; c += 1) {
        if (game.currentPiece.matrix[r][c]) {
          const gy = ghostY + r
          const gx = game.currentPiece.x + c
          if (gy >= 0 && gy < BOARD_HEIGHT && gx >= 0 && gx < BOARD_WIDTH) {
            if (!displayBoard[gy][gx]) {
              displayBoard[gy][gx] = 'GHOST'
            }
          }
        }
      }
    }

    // 현재 블록 표시
    for (let r = 0; r < game.currentPiece.matrix.length; r += 1) {
      for (let c = 0; c < game.currentPiece.matrix[r].length; c += 1) {
        if (game.currentPiece.matrix[r][c]) {
          const py = game.currentPiece.y + r
          const px = game.currentPiece.x + c
          if (py >= 0 && py < BOARD_HEIGHT && px >= 0 && px < BOARD_WIDTH) {
            displayBoard[py][px] = game.currentPiece.type
          }
        }
      }
    }
  }

  // 다음 블록 4x4 미리보기 격자
  const nextGrid = Array.from({ length: 4 }, () => Array(4).fill(null))
  if (game.nextPiece) {
    const m = game.nextPiece.matrix
    const offsetR = Math.floor((4 - m.length) / 2)
    const offsetC = Math.floor((4 - m[0].length) / 2)
    for (let r = 0; r < m.length; r += 1) {
      for (let c = 0; c < m[r].length; c += 1) {
        if (m[r][c]) {
          nextGrid[offsetR + r][offsetC + c] = game.nextPiece.type
        }
      }
    }
  }

  const statusTextMap = {
    idle: user ? '대기 중' : '로그인 필요',
    playing: '게임 진행 중',
    paused: '일시정지됨',
    gameover: '게임 오버',
  }

  const dropSpeedMs = getDropInterval(game.level)
  const isPlaying = game.status === 'playing' && Boolean(user)
  const userDisplayName = user?.displayName || user?.email || '플레이어'

  return (
    <div className="tetris-wrapper">
      <header className="tetris-header">
        <div className="title-group">
          <h1>테트리스 (TETRIS)</h1>
          <p>10 × 20 클래식 아케이드 모드 · 무한 서바이벌</p>
        </div>
        <span className={`status-badge status-${game.status}`}>
          {statusTextMap[game.status]}
        </span>
      </header>

      {/* Google 로그인 / 사용자 정보 바 */}
      <section className="auth-bar" aria-label="사용자 인증 영역">
        {authLoading ? (
          <span className="auth-guest-message">로그인 상태를 확인하고 있습니다...</span>
        ) : user ? (
          <>
            <div className="auth-user-info">
              <div className="user-profile">
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={userDisplayName}
                    className="user-avatar"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="user-text">
                  <span className="user-label">로그인 사용자</span>
                  <span className="user-name">{userDisplayName}</span>
                </div>
              </div>

              <div className="best-score-slot" aria-label="개인 최고 점수 표시 자리">
                <span className="best-score-label">개인 최고 점수</span>
                <span className="best-score-placeholder">저장 연동 예정</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-logout"
              onClick={handleLogout}
            >
              로그아웃
            </button>
          </>
        ) : (
          <>
            <span className="auth-guest-message">
              게임을 시작하려면 Google 계정으로 로그인해 주세요.
            </span>
            <button
              type="button"
              className="btn-google"
              onClick={handleGoogleLogin}
              disabled={isSigningIn}
            >
              {isSigningIn ? '로그인 창 여는 중...' : 'Google로 로그인'}
            </button>
          </>
        )}
      </section>

      {/* 로그인 취소 / 실패 / 안내 메시지 */}
      {authMessage && (
        <div
          className={`auth-notice ${
            authMessage.type === 'error' ? 'auth-notice-error' : 'auth-notice-info'
          }`}
          role="alert"
        >
          <span>{authMessage.text}</span>
          <button
            type="button"
            className="notice-close"
            onClick={() => setAuthMessage(null)}
            aria-label="안내 닫기"
          >
            닫기
          </button>
        </div>
      )}

      <main className="game-main">
        {/* 왼쪽: 10x20 게임판 & 휴대폰용 조작 버튼 */}
        <section className="board-section" aria-label="테트리스 게임판 영역">
          <div className="board-frame">
            <div className="board-grid">
              {displayBoard.map((row, rIdx) =>
                row.map((cell, cIdx) => {
                  let cellClass = 'cell'
                  if (cell === 'GHOST') {
                    cellClass += ' ghost'
                  } else if (cell) {
                    cellClass += ` filled cell-${cell}`
                  }
                  return <div key={`${rIdx}-${cIdx}`} className={cellClass} />
                })
              )}
            </div>

            {game.status === 'idle' && (
              <div className="board-overlay">
                {authLoading ? (
                  <>
                    <div className="overlay-title">로그인 확인 중</div>
                    <p className="overlay-desc">잠시만 기다려 주세요...</p>
                  </>
                ) : user ? (
                  <>
                    <div className="overlay-title">테트리스 시작하기</div>
                    <p className="overlay-desc">
                      {userDisplayName}님, 클리어 목표 없이 최고 점수에 도전하세요!
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleStart}
                    >
                      게임 시작
                    </button>
                  </>
                ) : (
                  <>
                    <div className="overlay-title">로그인이 필요합니다</div>
                    <p className="overlay-desc">
                      로그인한 사용자만 게임을 시작할 수 있습니다.
                    </p>
                    <button
                      type="button"
                      className="btn-google"
                      onClick={handleGoogleLogin}
                      disabled={isSigningIn}
                    >
                      {isSigningIn ? '로그인 창 여는 중...' : 'Google로 로그인'}
                    </button>
                  </>
                )}
              </div>
            )}

            {game.status === 'paused' && (
              <div className="board-overlay">
                <div className="overlay-title">일시정지</div>
                <p className="overlay-desc">게임을 이어서 진행하려면 아래 버튼을 누르세요.</p>
                <button type="button" className="btn btn-primary" onClick={handleTogglePause}>
                  계속하기
                </button>
              </div>
            )}

            {game.status === 'gameover' && (
              <div className="board-overlay">
                <div className="overlay-title">게임 오버</div>
                <div className="overlay-score">
                  이번 게임 점수: {game.score.toLocaleString('ko-KR')}점
                </div>
                <p className="overlay-desc">
                  도달 레벨 Lv.{game.level} · 지운 줄 수 {game.lines}줄
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRestart}
                  disabled={!user}
                >
                  다시 시작
                </button>
              </div>
            )}
          </div>

          {/* 휴대폰용 조작 버튼 */}
          <div className="mobile-controls" aria-label="휴대폰용 조작 버튼">
            <div className="mobile-row-top">
              <button
                type="button"
                className="touch-btn"
                disabled={!isPlaying}
                onClick={() => moveHorizontal(-1)}
              >
                <span className="touch-icon">◀</span>
                <span className="touch-label">왼쪽 이동</span>
              </button>
              <button
                type="button"
                className="touch-btn"
                disabled={!isPlaying}
                onClick={rotatePiece}
              >
                <span className="touch-icon">↻</span>
                <span className="touch-label">회전</span>
              </button>
              <button
                type="button"
                className="touch-btn"
                disabled={!isPlaying}
                onClick={() => moveHorizontal(1)}
              >
                <span className="touch-icon">▶</span>
                <span className="touch-label">오른쪽 이동</span>
              </button>
            </div>
            <div className="mobile-row-bottom">
              <button
                type="button"
                className="touch-btn"
                disabled={!isPlaying}
                onClick={() => stepDown(true)}
              >
                <span className="touch-icon">▼</span>
                <span className="touch-label">빠르게 내리기</span>
              </button>
              <button
                type="button"
                className="touch-btn touch-btn-drop"
                disabled={!isPlaying}
                onClick={hardDrop}
              >
                <span className="touch-icon">⤓</span>
                <span className="touch-label">즉시 떨어뜨리기</span>
              </button>
            </div>
          </div>
        </section>

        {/* 오른쪽: 상태 표시판 및 제어 버튼 */}
        <aside className="side-panel">
          {/* 시작 · 일시정지 · 다시 시작 버튼 */}
          <div className="panel-card">
            <div className="card-title">게임 제어</div>
            <div className="action-buttons">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStart}
                disabled={!user || game.status === 'playing'}
              >
                시작
              </button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={handleTogglePause}
                disabled={!user || (game.status !== 'playing' && game.status !== 'paused')}
              >
                {game.status === 'paused' ? '계속하기' : '일시정지'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleRestart}
                disabled={!user}
              >
                다시 시작
              </button>
            </div>
          </div>

          {/* 다음 블록 표시 */}
          <div className="panel-card">
            <div className="card-title">다음 블록</div>
            <div className="next-piece-wrap">
              <div className="next-grid" aria-label="다음 블록 미리보기">
                {nextGrid.map((row, rIdx) =>
                  row.map((cell, cIdx) => (
                    <div
                      key={`next-${rIdx}-${cIdx}`}
                      className={`cell ${cell ? `filled cell-${cell}` : ''}`}
                    />
                  ))
                )}
              </div>
              <div className="next-info">
                <span>다음 출현 예정:</span>
                <span className="next-badge">
                  {game.nextPiece ? game.nextPiece.name : '-'}
                </span>
                <span>10줄 삭제마다 레벨이 올라갑니다.</span>
              </div>
            </div>
          </div>

          {/* 점수 · 레벨 · 지운 줄 수 · 개인 최고 점수 자리 */}
          <div className="panel-card">
            <div className="card-title">게임 기록 현황</div>
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">현재 점수</span>
                <span className="stat-value">{game.score.toLocaleString('ko-KR')}</span>
                <span className="stat-sub">줄 삭제 · 드롭 가산점</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">개인 최고 점수</span>
                <span className="stat-value-placeholder">저장 연동 예정</span>
                <span className="stat-sub">다음 단계에서 Firestore 연동</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">레벨</span>
                <span className="stat-value">Lv.{game.level}</span>
                <span className="stat-sub">낙하 속도 {(dropSpeedMs / 1000).toFixed(2)}초</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">지운 줄 수</span>
                <span className="stat-value">{game.lines}줄</span>
                <span className="stat-sub">다음 레벨까지 {10 - (game.lines % 10)}줄</span>
              </div>
            </div>
          </div>

          {/* 키보드 조작법 & 점수표 */}
          <div className="panel-card">
            <div className="card-title">키보드 조작 방법</div>
            <ul className="controls-guide">
              <li>
                <span>좌우 이동</span>
                <span className="key-badge">← / → (A / D)</span>
              </li>
              <li>
                <span>블록 회전</span>
                <span className="key-badge">↑ (W / X)</span>
              </li>
              <li>
                <span>빠르게 내리기 (+1점/칸)</span>
                <span className="key-badge">↓ (S)</span>
              </li>
              <li>
                <span>즉시 떨어뜨리기 (+2점/칸)</span>
                <span className="key-badge">Space</span>
              </li>
              <li>
                <span>일시정지 / 계속하기</span>
                <span className="key-badge">P / Esc</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  )
}
