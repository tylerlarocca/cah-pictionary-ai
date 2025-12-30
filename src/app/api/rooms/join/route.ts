import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = { name: string; joinCode: string };

export async function POST(req: Request) {
  const { name, joinCode } = (await req.json()) as Body;

  const displayName = (name ?? "").trim();
  const code = (joinCode ?? "").trim().toUpperCase();

  if (!displayName) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json(
      { error: "Join code is required." },
      { status: 400 }
    );
  }

  const db = supabaseServer();

  const { data: room, error: roomErr } = await db
    .from("rooms")
    .select("id, join_code, status, max_players")
    .eq("join_code", code)
    .single();

  if (roomErr || !room) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }
  if (room.status === "ENDED") {
    return NextResponse.json(
      { error: "This game has ended." },
      { status: 400 }
    );
  }

  // enforce max players (active)
  const { count, error: countErr } = await db
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("room_id", room.id)
    .eq("is_active", true);

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= room.max_players) {
    return NextResponse.json({ error: "Room is full." }, { status: 400 });
  }

  const { data: player, error: playerErr } = await db
    .from("players")
    .insert({
      room_id: room.id,
      display_name: displayName,
      is_host: false,
      is_active: true,
    })
    .select("id")
    .single();

  if (playerErr) {
    // duplicate name (because we made a unique index)
    if (String(playerErr.message).toLowerCase().includes("duplicate")) {
      return NextResponse.json(
        { error: "That name is already taken in this room." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: playerErr.message }, { status: 500 });
  }

  return NextResponse.json({
    roomId: room.id,
    joinCode: room.join_code,
    playerId: player.id,
    isHost: false,
  });
}
