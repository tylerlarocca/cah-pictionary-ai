"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Player = {
  id: string;
  display_name: string;
  is_host: boolean;
  is_active: boolean;
  created_at: string;
};

type Round = {
  id: string;
  round_number: number;
  phase: "PROMPT" | "GENERATING" | "REVEAL" | "VOTING" | "RESULTS";
  prompt_text: string;
  created_at: string;
};

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const joinCode = (params?.code ?? "").toUpperCase();

  const supabase = useMemo(() => supabaseBrowser(), []);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // MVP "session" from localStorage
  const isHost =
    typeof window !== "undefined" && localStorage.getItem("isHost") === "true";
  const playerId =
    typeof window !== "undefined" ? localStorage.getItem("playerId") : null;

  // 1) Look up room by join code
  useEffect(() => {
    if (!joinCode) return;

    let cancelled = false;

    async function loadRoom() {
      setError(null);

      const { data, error } = await supabase
        .from("rooms")
        .select("id")
        .eq("join_code", joinCode)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setError("Room not found.");
        setRoomId(null);
        return;
      }

      setRoomId(data.id);
    }

    loadRoom();

    return () => {
      cancelled = true;
    };
  }, [supabase, joinCode]);

  // 2) Load players + subscribe to realtime changes
  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function loadPlayers() {
      const { data, error } = await supabase
        .from("players")
        .select("id, display_name, is_host, is_active, created_at")
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
        () => {
          // simple MVP: re-fetch on any change
          loadPlayers();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

  // 3) Load latest round + subscribe to realtime changes
  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function loadLatestRound() {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, phase, prompt_text, created_at")
        .eq("room_id", roomId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setError(error.message);
        return;
      }

      setCurrentRound((data as Round) ?? null);
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
        () => {
          loadLatestRound();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, roomId]);

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

      // No need to setCurrentRound manually; realtime will pick it up
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Failed to start round.");
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen p-6 flex justify-center">
      <div className="w-full max-w-2xl space-y-6">
        <header className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h1 className="text-2xl font-semibold">Room {joinCode}</h1>
          <p className="text-sm text-white/70">
            Share this code with friends to join. Max 8 players.
          </p>
          <p className="text-xs text-white/50 mt-2">
            You are {isHost ? "the host 👑" : "a player"}.
          </p>
        </header>

        {error ? (
          <p className="text-sm text-red-300 border border-red-500/30 bg-red-500/10 rounded-xl p-3">
            {error}
          </p>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold mb-3">Players</h2>

          <ul className="space-y-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-2"
              >
                <span className="font-medium">
                  {p.display_name} {p.is_host ? "👑" : ""}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-white/60">
            Open this room in another tab and join — the list should update
            instantly.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Round</h2>

            {isHost && (
              <button
                className="rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
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
          </div>

          {currentRound ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-white/70">
                Round {currentRound.round_number}
              </p>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-base">{currentRound.prompt_text}</p>
              </div>

              <p className="text-xs text-white/60">
                Phase: {currentRound.phase}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-white/70">
              No round started yet.{" "}
              {isHost ? "Click Start round to begin." : "Waiting for host…"}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
