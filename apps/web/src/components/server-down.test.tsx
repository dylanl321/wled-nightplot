import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerDown } from "@/components/server-down";

describe("ServerDown recovery copy", () => {
  it("names local pnpm dev and Docker restart without claiming one run mode", () => {
    render(<ServerDown />);

    expect(
      screen.getByText(/Couldn’t reach the configure server/),
    ).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body).toContain("pnpm dev");
    expect(body).toContain("docker compose");
    expect(body).toContain("docs/deploy.md");
    expect(body).toMatch(/not assume a host pnpm workspace/);
  });
});
