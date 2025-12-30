"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"create" | "join" | null>(null);

  async function createRoom() {
    setError(null);
    setLoading("create");
    try {
      const res = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create room.");

      // store player session locally (MVP)
      localStorage.setItem("playerId", data.playerId);
      localStorage.setItem("joinCode", data.joinCode);
      localStorage.setItem("isHost", "true");

      router.push(`/room/${data.joinCode}`);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Failed to start round.");
      }
    } finally {
      setLoading(null);
    }
  }

  async function joinRoom() {
    setError(null);
    setLoading("join");
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, joinCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to join room.");

      localStorage.setItem("playerId", data.playerId);
      localStorage.setItem("joinCode", data.joinCode);
      localStorage.setItem("isHost", "false");

      router.push(`/room/${data.joinCode}`);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Failed to start round.");
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <div>
          <h1 className="text-2xl font-semibold">AI Pictionary Party</h1>
          <p className="text-sm text-white/70">
            Create a private room, invite friends, and vote on the funniest AI
            image.
          </p>
        </div>

        <label className="block space-y-2">
          <span className="text-sm text-white/80">Your name</span>
          <input
            className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tyler"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-medium disabled:opacity-60"
            onClick={createRoom}
            disabled={loading !== null}
          >
            {loading === "create" ? "Creating..." : "Create room"}
          </button>

          <button
            className="rounded-xl border border-white/15 px-4 py-2 font-medium disabled:opacity-60"
            onClick={joinRoom}
            disabled={loading !== null}
          >
            {loading === "join" ? "Joining..." : "Join room"}
          </button>
        </div>

        <label className="block space-y-2">
          <span className="text-sm text-white/80">Join code</span>
          <input
            className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none uppercase tracking-widest"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="ABCD"
          />
        </label>

        {error ? (
          <p className="text-sm text-red-300 border border-red-500/30 bg-red-500/10 rounded-xl p-3">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
