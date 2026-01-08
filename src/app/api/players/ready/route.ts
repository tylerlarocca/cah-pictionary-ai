// src/app/api/players/ready/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { generatePrompt } from "@/lib/ai/promptGenerator";
import { pickRandomPrompt } from "@/lib/prompts";

type Body = { joinCode: string; playerId: string };

export async function POST(req: Request) {
  try {
    const { joinCode, playerId } = (await req.json()) as Body;

    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();

    if (!code || !pid) {
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    // 1) Find room + settings needed for auto-start
    const { data: room, error: roomErr } = await db
      .from("rooms")
      .select("id, status, is_family_friendly, round_seconds, total_rounds")
      .eq("join_code", code)
      .single();

    if (roomErr || !room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.status === "ENDED") {
      return NextResponse.json({ error: "Game has ended." }, { status: 400 });
    }

    // 2) Verify player belongs to room and is active
    const { data: player, error: playerErr } = await db
      .from("players")
      .select("id, room_id, is_ready, is_active")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();

    if (playerErr || !player) {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }

    if (!player.is_active) {
      return NextResponse.json(
        { error: "Player is not active." },
        { status: 400 }
      );
    }

    // 3) Toggle readiness
    const nextReady = !player.is_ready;

    const { error: toggleErr } = await db
      .from("players")
      .update({ is_ready: nextReady })
      .eq("id", pid)
      .eq("room_id", room.id);

    if (toggleErr) {
      return NextResponse.json({ error: toggleErr.message }, { status: 500 });
    }

    // 4) Check if all active players are ready
    const { data: activePlayers, error: activeErr } = await db
      .from("players")
      .select("id, is_ready")
      .eq("room_id", room.id)
      .eq("is_active", true);

    if (activeErr) {
      return NextResponse.json({ error: activeErr.message }, { status: 500 });
    }

    const active = activePlayers ?? [];
    const allReady = active.length > 0 && active.every((p) => p.is_ready);

    // 5) Auto-start Round 1 ONLY when:
    //    - room is still in LOBBY
    //    - everyone is ready
    //    - there are no rounds yet (idempotent)
    if (allReady && room.status === "LOBBY") {
      const { data: lastRound, error: lastErr } = await db
        .from("rounds")
        .select("round_number")
        .eq("room_id", room.id)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastErr) {
        return NextResponse.json({ error: lastErr.message }, { status: 500 });
      }

      // If no rounds exist yet, create Round 1 in PROMPT phase
      if (!lastRound) {
        let prompt_text: string;
        try {
          prompt_text = await generatePrompt({
            familyFriendly: !!room.is_family_friendly,
          });
        } catch {
          prompt_text = pickRandomPrompt();
        }

        const phase_ends_at = new Date(Date.now() + 5_000).toISOString();

        const { error: insertErr } = await db.from("rounds").insert({
          room_id: room.id,
          round_number: 1,
          phase: "PROMPT",
          prompt_text,
          phase_ends_at,
        });

        if (insertErr) {
          return NextResponse.json(
            { error: insertErr.message },
            { status: 500 }
          );
        }

        // Set room to IN_GAME
        const { error: roomUpdateErr } = await db
          .from("rooms")
          .update({ status: "IN_GAME" })
          .eq("id", room.id)
          .eq("status", "LOBBY"); // idempotent guard

        if (roomUpdateErr) {
          return NextResponse.json(
            { error: roomUpdateErr.message },
            { status: 500 }
          );
        }

        // Reset readiness for next round cycle (so ready-up can be used again later)
        await db
          .from("players")
          .update({ is_ready: false })
          .eq("room_id", room.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
