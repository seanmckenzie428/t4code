import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProjectCustomAction } from "./pilotCompatibility.ts";

const decodeCustomAction = Schema.decodeUnknownEffect(ProjectCustomAction);

it.effect("decodes legacy project custom actions without an icon", () =>
  Effect.gen(function* () {
    const action = yield* decodeCustomAction({
      id: "admin",
      name: "Admin",
      placement: "menu",
      commandId: "ui.external-url.open",
      args: { url: "https://admin.example.test" },
    });
    assert.strictEqual(action.icon, "play");
  }),
);
