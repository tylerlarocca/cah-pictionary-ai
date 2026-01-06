"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Room = {
  id: string;
  status: "LOBBY" | "IN_GAME" | "ENDED";
  is_family_friendly: boolean;
  total_rounds: number;
  round_seconds: number;
};

type Player = {
  id: string;
  display_name: string;
  is_host: boolean;
  is_ready: boolean;
  is_active: boolean;
  created_at: string;
};

type RoundPhase = "PROMPT" | "GENERATING" | "REVEAL" | "VOTING" | "RESULTS";

type Round = {
  id: string;
  room_id?: string;
  round_number: number;
  phase: RoundPhase;
  prompt_text: string;
  created_at: string;
  phase_ends_at: string | null;
};

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const joinCode = (params?.code ?? "").toUpperCase();

  const supabase = useMemo(() => supabaseBrowser(), []);

  // MVP "session" from localStorage (loaded client-side safely)
  const [isHost, setIsHost] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsHost(localStorage.getItem("isHost") === "true");
    setPlayerId(localStorage.getItem("playerId"));
  }, []);

  const [room, setRoom] = useState<Room | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI actions
  const [starting, setStarting] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [togglingReady, setTogglingReady] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rematching, setRematching] = useState(false);

  // Submission UI (text for now)
  const [promptInput, setPromptInput] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Prompt animation
  const [animatePrompt, setAnimatePrompt] = useState(false);

  // Prevent double-advance at the boundary
  const lastAdvanceKeyRef = useRef<string>("");

  // Derived readiness
  const activeCount = players.length;
  const readyCount = players.filter((p) => p.is_ready).length;
  const me = playerId ? players.find((p) => p.id === playerId) : undefined;
  const iAmReady = !!me?.is_ready;

  // ---------------------------
  // 1) Load room by join code + subscribe to room updates
  // ---------------------------
  useEffect(() => {
    if (!joinCode) return;

    let cancelled = false;

    async function loadRoom() {
      setError(null);

      const { data, error } = await supabase
        .from("rooms")
        .select("id, status, is_family_friendly, total_rounds, round_seconds")
        .eq("join_code", joinCode)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setError("Room not found.");
        setRoom(null);
        setRoomId(null);
        return;
      }

      setRoom(data as Room);
      setRoomId(data.id);
    }

    loadRoom();

    return () => {
      cancelled = true;
    };
  }, [supabase, joinCode]);

  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function refreshRoom() {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, status, is_family_friendly, total_rounds, round_seconds")
        .eq("id", roomId)
        .single();

      if (!mounted) return;
      if (error || !data) return;

      setRoom(data as Room);
    }

    const channel = supabase
      .channel(`room:${roomId}:room`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => refreshRoom()
      )
      .subscribe();

    refreshRoom();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

  // ---------------------------
  // 2) Load players + realtime
  // ---------------------------
  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function loadPlayers() {
      const { data, error } = await supabase
        .from("players")
        .select("id, display_name, is_host, is_ready, is_active, created_at")
        .eq("room_id", roomId)
        .eq("is_active", true)
        .order("created_at", { ascending: true });

      if (!mounted) return;

      if (error) {
        setError(error.message);
        return;
      }

      setPlayers((data ?? []) as Player[]);
    }

    loadPlayers();

    const channel = supabase
      .channel(`room:${roomId}:players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        () => loadPlayers()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

  // ---------------------------
  // 3) Load latest round + realtime
  // ---------------------------
  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function loadLatestRound() {
      const { data, error } = await supabase
        .from("rounds")
        .select(
          "id, round_number, phase, prompt_text, created_at, phase_ends_at"
        )
        .eq("room_id", roomId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setError(error.message);
        return;
      }

      const next = (data as Round) ?? null;
      setCurrentRound(next);
    }

    loadLatestRound();

    const channel = supabase
      .channel(`room:${roomId}:rounds`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
          filter: `room_id=eq.${roomId}`,
        },
        () => loadLatestRound()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

  // ---------------------------
  // 4) Prompt animation trigger
  // ---------------------------
  useEffect(() => {
    if (!currentRound) return;
    setAnimatePrompt(true);
    const t = setTimeout(() => setAnimatePrompt(false), 650);
    return () => clearTimeout(t);
  }, [currentRound?.id, currentRound?.prompt_text, currentRound?.phase]);

  // ---------------------------
  // 5) Timer: compute seconds left from phase_ends_at
  // ---------------------------
  useEffect(() => {
    if (!currentRound?.phase_ends_at) {
      setSecondsLeft(null);
      return;
    }

    const tick = () => {
      const end = new Date(currentRound.phase_ends_at!).getTime();
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setSecondsLeft(s);
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [currentRound?.phase_ends_at]);

  // ---------------------------
  // 6) Auto-advance on timer end (PROMPT->GENERATING, GENERATING->REVEAL)
  // Use phase_ends_at + scheduled timeout (most reliable)
  // ---------------------------
  useEffect(() => {
    if (!room || !currentRound) return;
    if (room.status !== "IN_GAME") return;

    if (currentRound.phase !== "PROMPT" && currentRound.phase !== "GENERATING")
      return;
    if (!currentRound.phase_ends_at) return;

    const endMs = new Date(currentRound.phase_ends_at).getTime();
    const key = `${currentRound.id}:${currentRound.phase}:${currentRound.phase_ends_at}`;

    // If already past end, advance immediately (once)
    if (Date.now() >= endMs) {
      if (lastAdvanceKeyRef.current !== key) {
        lastAdvanceKeyRef.current = key;
        void advancePhase();
      }
      return;
    }

    // Otherwise schedule when it ends (+small buffer)
    const delayMs = Math.max(0, endMs - Date.now()) + 50;

    const t = window.setTimeout(() => {
      if (lastAdvanceKeyRef.current === key) return;
      lastAdvanceKeyRef.current = key;
      void advancePhase();
    }, delayMs);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    room?.status,
    currentRound?.id,
    currentRound?.phase,
    currentRound?.phase_ends_at,
  ]);

  // ---------------------------
  // 7) Track whether I submitted for the current round (minimal fetch)
  // ---------------------------
  useEffect(() => {
    if (!roomId || !currentRound?.id || !playerId) {
      setHasSubmitted(false);
      return;
    }

    let mounted = true;
    const roundId = currentRound.id;

    async function checkSubmission() {
      const { data } = await supabase
        .from("submissions")
        .select("id")
        .eq("room_id", roomId)
        .eq("round_id", roundId)
        .eq("player_id", playerId)
        .maybeSingle();

      if (!mounted) return;
      setHasSubmitted(!!data);
    }

    checkSubmission();

    return () => {
      mounted = false;
    };
  }, [supabase, roomId, currentRound?.id, playerId]);

  // ---------------------------
  // Actions
  // ---------------------------
  async function startRound() {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const res = await fetch("/api/rounds/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start round.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to start round.";
      setError(msg);
    } finally {
      setStarting(false);
    }
  }

  async function rerollPrompt() {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }

    setRerolling(true);
    setError(null);

    try {
      const res = await fetch("/api/rounds/reroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reroll prompt.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to reroll prompt.";
      setError(msg);
    } finally {
      setRerolling(false);
    }
  }

  async function toggleReady() {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }

    setTogglingReady(true);
    setError(null);

    try {
      const res = await fetch("/api/players/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to toggle ready.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to toggle ready.";
      setError(msg);
    } finally {
      setTogglingReady(false);
    }
  }

  async function saveFamilyFriendly(next: boolean) {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }

    setSavingSettings(true);
    setError(null);

    try {
      const res = await fetch("/api/rooms/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId, isFamilyFriendly: next }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update settings.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update settings.";
      setError(msg);
    } finally {
      setSavingSettings(false);
    }
  }

  async function advancePhase() {
    if (!playerId) return;

    if (advancing) return;
    setAdvancing(true);
    setError(null);

    try {
      const res = await fetch("/api/rounds/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to advance phase.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to advance phase.";
      setError(msg);
    } finally {
      setAdvancing(false);
    }
  }

  async function submitMyPrompt() {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }
    if (!currentRound) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/submissions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId, promptInput }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit.");
      setHasSubmitted(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to submit.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function rematch() {
    if (!playerId) {
      setError("Missing player session. Go back and re-join the room.");
      return;
    }

    setRematching(true);
    setError(null);

    try {
      const res = await fetch("/api/game/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, playerId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rematch.");

      // Clear local round/submission UI; realtime will refill
      setCurrentRound(null);
      setPromptInput("");
      setHasSubmitted(false);
      lastAdvanceKeyRef.current = "";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to rematch.";
      setError(msg);
    } finally {
      setRematching(false);
    }
  }

  // ---------------------------
  // Render helpers
  // ---------------------------
  const showLobby = room?.status === "LOBBY";
  const showInGame = room?.status === "IN_GAME";
  const showEnded = room?.status === "ENDED";

  const roundLabel = currentRound
    ? `Round ${currentRound.round_number} / ${room?.total_rounds ?? 3}`
    : `Round / ${room?.total_rounds ?? 3}`;

  const showTimer =
    !!currentRound?.phase_ends_at &&
    (currentRound.phase === "PROMPT" || currentRound.phase === "GENERATING");

  const timerText = secondsLeft === null ? "" : `${secondsLeft}s`;

  return (
    <main className="min-h-screen p-6 flex justify-center">
      <div className="w-full max-w-2xl space-y-6">
        <header className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Room {joinCode}</h1>
              <p className="text-sm text-white/70">
                Share this code with friends to join. Max 8 players.
              </p>
              <p className="text-xs text-white/50 mt-2">
                You are {isHost ? "the host 👑" : "a player"}.
              </p>
            </div>

            <div className="text-right text-xs text-white/60">
              <div>Status: {room?.status ?? "…"}</div>
              <div>{roundLabel}</div>
            </div>
          </div>

          {error ? (
            <p className="mt-4 text-sm text-red-300 border border-red-500/30 bg-red-500/10 rounded-xl p-3">
              {error}
            </p>
          ) : null}
        </header>

        {/* SETTINGS (Host-only, Lobby-only) */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Lobby</h2>

            <div className="text-xs text-white/60">
              Ready: {readyCount}/{activeCount}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-white/80">
              <div className="font-medium">Family-friendly prompts</div>
              <div className="text-xs text-white/60">
                Host can toggle in the lobby only.
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-white/60">
                {room?.is_family_friendly ? "ON" : "OFF"}
              </span>

              <button
                className="rounded-xl border border-white/15 px-4 py-2 font-medium disabled:opacity-60"
                disabled={!isHost || !showLobby || savingSettings || !room}
                onClick={() =>
                  room ? saveFamilyFriendly(!room.is_family_friendly) : null
                }
                title={
                  !isHost
                    ? "Host only"
                    : !showLobby
                    ? "Only editable in lobby"
                    : "Toggle family-friendly"
                }
              >
                {savingSettings ? "Saving..." : "Toggle"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              className="rounded-xl border border-white/15 px-4 py-2 font-medium disabled:opacity-60"
              onClick={toggleReady}
              disabled={togglingReady}
            >
              {togglingReady ? "..." : iAmReady ? "Unready" : "Ready"}
            </button>

            {isHost && showLobby && (
              <p className="text-xs text-white/60">
                When everyone is ready, the game auto-starts.
              </p>
            )}

            {isHost && showInGame && (
              <button
                className="ml-auto rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
                onClick={startRound}
                disabled={starting}
              >
                {starting
                  ? "Starting..."
                  : currentRound
                  ? "Start next round"
                  : "Start round"}
              </button>
            )}

            {isHost && showEnded && (
              <button
                className="ml-auto rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
                onClick={rematch}
                disabled={rematching}
              >
                {rematching ? "Resetting..." : "Rematch"}
              </button>
            )}
          </div>

          {showEnded ? (
            <p className="mt-3 text-sm text-white/70">
              Game over.{" "}
              {isHost
                ? "Hit Rematch to reset rounds and play again."
                : "Waiting for host to rematch."}
            </p>
          ) : null}
        </section>

        {/* PLAYERS */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold mb-3">Players</h2>

          <ul className="space-y-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-2"
              >
                <span className="font-medium">
                  {p.display_name} {p.is_host ? "👑" : ""}{" "}
                  {p.is_ready ? "✅" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ROUND / GAME LOOP */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Round</h2>
              <p className="text-xs text-white/60 mt-1">
                {currentRound ? `Phase: ${currentRound.phase}` : "No round yet"}
                {showTimer ? ` • Timer: ${timerText}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Host prompt controls */}
              {isHost && currentRound?.phase === "PROMPT" && (
                <button
                  className="rounded-xl border border-white/15 px-4 py-2 font-medium disabled:opacity-60"
                  onClick={rerollPrompt}
                  disabled={rerolling}
                >
                  {rerolling ? "Rerolling..." : "Reroll"}
                </button>
              )}

              {/* Host manual continue (REVEAL -> RESULTS) */}
              {isHost && currentRound?.phase === "REVEAL" && (
                <button
                  className="rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
                  onClick={advancePhase}
                  disabled={advancing}
                  title="Continue to Results"
                >
                  {advancing ? "..." : "Continue"}
                </button>
              )}
            </div>
          </div>

          {/* Prompt card */}
          {currentRound ? (
            <div
              className={[
                "mt-4 rounded-xl border border-white/10 bg-black/20 p-4 transition-all duration-500",
                animatePrompt
                  ? "translate-y-0 opacity-100 scale-[1.01]"
                  : "translate-y-[0px] opacity-100 scale-100",
              ].join(" ")}
            >
              <p className="text-base leading-relaxed">
                {currentRound.prompt_text}
              </p>

              {currentRound.phase === "PROMPT" ? (
                <p className="mt-2 text-xs text-white/60">
                  Get ready — submissions open next.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-white/70">
              {isHost
                ? "Waiting in the lobby. Have everyone ready up to auto-start, or start manually once in-game."
                : "Waiting for host to start the game…"}
            </p>
          )}

          {/* GENERATING: Submission UI */}
          {currentRound?.phase === "GENERATING" ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm text-white/80">
                  Add a silly detail for your image (we’ll turn this into the AI
                  image next).
                </p>

                <textarea
                  className="mt-3 w-full rounded-xl bg-black/40 border border-white/10 p-3 text-sm outline-none"
                  rows={3}
                  placeholder='Example: "make it in claymation style with googly eyes"'
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  disabled={hasSubmitted}
                />

                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-white/60">
                    {hasSubmitted
                      ? "Submitted ✅"
                      : "One submission per round."}
                  </p>

                  <button
                    className="rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
                    disabled={
                      submitting ||
                      hasSubmitted ||
                      promptInput.trim().length === 0
                    }
                    onClick={submitMyPrompt}
                  >
                    {submitting
                      ? "Submitting..."
                      : hasSubmitted
                      ? "Submitted"
                      : "Submit"}
                  </button>
                </div>
              </div>

              <p className="text-xs text-white/60">
                When the timer hits 0, the round auto-reveals.
              </p>
            </div>
          ) : null}

          {/* REVEAL placeholder */}
          {currentRound?.phase === "REVEAL" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white/80">
                Reveal phase (next we’ll display everyone’s images here).
              </p>
              <p className="mt-2 text-xs text-white/60">
                Host clicks Continue when everyone’s ready.
              </p>
            </div>
          ) : null}

          {/* RESULTS placeholder */}
          {currentRound?.phase === "RESULTS" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white/80">
                Results phase (next we’ll score + show winner here).
              </p>

              {room?.status === "ENDED" ? (
                <p className="mt-2 text-xs text-white/60">
                  That was the final round. Host can rematch above.
                </p>
              ) : (
                <p className="mt-2 text-xs text-white/60">
                  Host can start the next round when ready.
                </p>
              )}
            </div>
          ) : null}
        </section>

        {/* Debug: uncomment if needed */}
        {/* <pre className="text-xs text-white/50">{JSON.stringify({ room, currentRound, secondsLeft }, null, 2)}</pre> */}
      </div>
    </main>
  );
}
