import { describe, expect, it } from "vite-plus/test";

import {
  CONNECT_PRODUCT_NAME,
  PRODUCT_NAME,
  PRODUCT_SHORT_NAME,
  REPOSITORY_SLUG,
  REPOSITORY_URL,
} from "./branding.ts";

describe("branding", () => {
  it("exports the personal fork display and repository names", () => {
    expect(PRODUCT_NAME).toBe("T4 Code");
    expect(PRODUCT_SHORT_NAME).toBe("T4");
    expect(CONNECT_PRODUCT_NAME).toBe("T4 Connect");
    expect(REPOSITORY_SLUG).toBe("seanmckenzie428/t4");
    expect(REPOSITORY_URL).toBe("https://github.com/seanmckenzie428/t4");
  });
});
