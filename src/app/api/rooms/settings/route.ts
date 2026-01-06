import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = {
  joinCode: string;
  playerId: string;
  isFamilyFriendly: boolean;
};

export async function POST(req: Request) {
  try {
    const { joinCode, playerId, isFamilyFriendly } = (await req.json()) as Body;

    const code = (joinCode ?? "").trim().toUpperCase();
    const pid = (playerId ?? "").trim();

    if (!code || !pid) {
      return NextResponse.json(
        { error: "Missing joinCode or playerId." },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    const { data: room } = await db
      .from("rooms")
      .select("id, status")
      .eq("join_code", code)
      .single();

    if (!room)
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    if (room.status !== "LOBBY") {
      return NextResponse.json(
        { error: "Settings can only change in the lobby." },
        { status: 400 }
      );
    }

    const { data: host } = await db
      .from("players")
      .select("is_host")
      .eq("id", pid)
      .eq("room_id", room.id)
      .single();

    if (!host?.is_host) {
      return NextResponse.json({ error: "Host only." }, { status: 403 });
    }

    const { error } = await db
      .from("rooms")
      .update({ is_family_friendly: !!isFamilyFriendly })
      .eq("id", room.id);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
