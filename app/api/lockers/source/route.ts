import input from "@/contracts/AutistikLocker.input.json";

/** The locker's full source, in the "Standard JSON input" format explorers use to verify contracts. Public. */
export function GET() {
  return new Response(JSON.stringify(input, null, 1), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="AutistikLocker.input.json"', "cache-control": "public, max-age=3600" },
  });
}
