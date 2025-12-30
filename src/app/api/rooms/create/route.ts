import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/joinCode";

type Body = { name: string };

export async function POST(req: Request) {
  const { name } = (await req.json()) as Body;

  const displayName = (name ?? "").trim();
  if (!displayName) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const db = supabaseServer();

  // try a few times in case join_code collides
  for (let attempt = 0; attempt < 5; attempt++) {
    const join_code = generateJoinCode(4);

    const { data: room, error: roomErr } = await db
      .from("rooms")
      .insert({ join_code, max_players: 8, status: "LOBBY" })
      .select("id, join_code")
      .single();

    if (roomErr) {
      // collision on join_code -> retry
      if (String(roomErr.message).toLowerCase().includes("duplicate")) continue;
      return NextResponse.json({ error: roomErr.message }, { status: 500 });
    }

    const { data: host, error: hostErr } = await db
      .from("players")
      .insert({
        room_id: room.id,
        display_name: displayName,
        is_host: true,
        is_active: true,
      })
      .select("id")
      .single();

    if (hostErr) {
      return NextResponse.json({ error: hostErr.message }, { status: 500 });
    }

    return NextResponse.json({
      roomId: room.id,
      joinCode: room.join_code,
      playerId: host.id,
      isHost: true,
    });
  }

  return NextResponse.json(
    { error: "Failed to generate a unique join code. Try again." },
    { status: 500 }
  );
}
