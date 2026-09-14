/**
 * @jest-environment jsdom
 *
 * B2 — UnlinkedServiceAccountModal
 *
 * Tests:
 *  1. Renders scopes returned by the resolver endpoint for an admin.
 *  2. Renders read-only notice and hides edit controls for non-admins.
 *  3. Shows "Add a scope" section for admins.
 *  4. Sends correct POST to /api/admin/service-accounts/[id]/scopes on add.
 *  5. Shows error banner on failed add (single occurrence).
 *  6. Shows remove-confirm flow before DELETE.
 *  7. Error from resolver is displayed (404/error case).
 *  8. Close button calls onOpenChange(false).
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnlinkedServiceAccountModal } from "../UnlinkedServiceAccountModal";

// ── shared fixtures ──

// QUAL-10: sa_sub removed from BFF response — only id/name/scopes
const ANON_SA = {
  id: "anon-sub-abc",
  name: "unlinked",
  scopes: [
    { type: "agent", ref: "hello-world" },
    { type: "tool", ref: "jira/search" },
  ],
};

const GRANTABLE = {
  agents: [
    { ref: "hello-world", name: "Hello World Agent" },
    { ref: "sre-agent", name: "SRE Agent" },
  ],
  tools: [{ ref: "jira/search", name: "Jira: search" }],
  datasources: [
    { ref: "ds-1", name: "Datasource One" },
    { ref: "ds-2", name: "Datasource Two" },
  ],
  collections: [{ ref: "coll-1", name: "Collection One" }],
};

const COLLECTION_MEMBERS = {
  success: true,
  data: { source_ids: ["ds-1", "ds-2", "ds-not-grantable"] },
};

function mockFetch({
  sa = { success: true, data: ANON_SA },
  grantable = { success: true, data: GRANTABLE },
  scopePost = { success: true, data: { added: { type: "agent", ref: "sre-agent" } } },
  scopeDelete = { success: true, data: { removed: { type: "agent", ref: "hello-world" } } },
  collectionMembers = COLLECTION_MEMBERS,
}: {
  sa?: object;
  grantable?: object;
  scopePost?: object;
  scopeDelete?: object;
  collectionMembers?: object;
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method?.toUpperCase() ?? "GET";

    if (href.includes("/api/admin/service-accounts/unlinked")) {
      return Promise.resolve({
        ok: (sa as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(sa),
      } as Response);
    }
    if (href.includes("/api/admin/service-accounts/grantable")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(grantable),
      } as Response);
    }
    if (href.includes("/api/rag/collections/") && method === "GET") {
      return Promise.resolve({
        ok: (collectionMembers as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(collectionMembers),
      } as Response);
    }
    if (href.includes("/scopes") && method === "POST") {
      return Promise.resolve({
        ok: (scopePost as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(scopePost),
      } as Response);
    }
    if (href.includes("/scopes") && method === "DELETE") {
      return Promise.resolve({
        ok: (scopeDelete as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(scopeDelete),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${href} [${method}]`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch();
});

describe("UnlinkedServiceAccountModal", () => {
  it("renders scopes returned by the resolver for an admin", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    // Use data-testid to avoid cross-element text matching issues
    await waitFor(() => {
      expect(screen.getByTestId("scope-agent-hello-world")).toBeInTheDocument();
    });
    expect(screen.getByTestId("scope-tool-jira/search")).toBeInTheDocument();
  });

  it("renders a global (everyone) agent as a locked chip with no remove button", async () => {
    mockFetch({
      sa: {
        success: true,
        data: {
          ...ANON_SA,
          scopes: [
            { type: "agent", ref: "default", source: "everyone" },
            { type: "agent", ref: "hello-world", source: "explicit" },
          ],
        },
      },
    });

    render(<UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("scope-agent-default")).toBeInTheDocument();
    });

    // The everyone-sourced agent must NOT expose a remove control...
    expect(
      screen.queryByRole("button", { name: /remove agent default/i }),
    ).not.toBeInTheDocument();
    // ...but the explicit one still does.
    expect(
      screen.getByRole("button", { name: /remove agent hello-world/i }),
    ).toBeInTheDocument();
    // And it carries a visible "Everyone" affordance.
    expect(screen.getByTestId("scope-source-everyone-default")).toBeInTheDocument();
  });

  it("keeps long scope refs from overflowing the list item (min-w-0/shrink-0/truncate)", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    const code = await screen.findByTestId("scope-agent-hello-world");
    expect(code).toHaveClass("truncate");

    const item = code.closest("li");
    expect(item).toHaveClass("min-w-0");

    const label = code.closest("span");
    expect(label).toHaveClass("min-w-0");

    const icon = label?.querySelector("svg");
    expect(icon).toHaveClass("shrink-0");
  });

  it("shows the Add a scope section for admins", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/add a scope/i)).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/service-accounts/grantable?context=unlinked",
    );
  });

  it("keeps Add scope controls in a responsive row that cannot bleed past the modal", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    const controls = await screen.findByTestId("unlinked-add-scope-controls");
    expect(controls).toHaveClass("min-w-0", "flex-col", "sm:flex-row");
    expect(screen.getByRole("combobox", { name: /scope type/i })).toHaveClass("min-w-0");
    expect(screen.getByRole("combobox", { name: /scope ref/i })).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByRole("button", { name: /^add$/i })).toHaveClass("w-full", "sm:w-auto");
  });

  it("hides Add a scope and shows read-only notice for non-admins", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin={false} onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("scope-agent-hello-world")).toBeInTheDocument();
    });
    expect(screen.queryByText(/add a scope/i)).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("explains when the SA has no access", async () => {
    mockFetch({
      sa: { success: true, data: { ...ANON_SA, scopes: [] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no access has been granted/i),
      ).toBeInTheDocument();
    });
  });

  it("sends POST to /scopes with the correct SA id and scope on add", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));

    // sre-agent is not in ANON_SA.scopes so it should appear in the ref picker.
    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.click(refSelect);
    fireEvent.click(await screen.findByRole("option", { name: "SRE Agent" }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "agent", ref: "sre-agent" }),
        }),
      );
    });
  });

  it("shows a single error banner when the POST fails", async () => {
    mockFetch({
      scopePost: { success: false, error: "You cannot grant a scope you do not hold" },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));

    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.click(refSelect);
    fireEvent.click(await screen.findByRole("option", { name: "SRE Agent" }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const errors = screen.getAllByTestId("unlinked-modal-error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toHaveTextContent(/cannot grant a scope you do not hold/i);
    });
  });

  it("shows confirm flow before DELETE and sends DELETE on confirm", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/remove agent hello-world/i)).toBeInTheDocument();
    });

    // Click the remove button to enter confirm flow
    fireEvent.click(screen.getByLabelText(/remove agent hello-world/i));
    expect(screen.getByText(/remove\?/i)).toBeInTheDocument();

    // Confirm the removal
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ type: "agent", ref: "hello-world" }),
        }),
      );
    });
  });

  it("shows an error when the resolver returns an error", async () => {
    mockFetch({
      sa: {
        success: false,
        error: "Unlinked service account not found or not yet bootstrapped",
      },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-error")).toHaveTextContent(
        /unlinked service account not found/i,
      );
    });
  });

  it("calls onOpenChange(false) when the Close button in the footer is clicked", async () => {
    const onOpenChange = jest.fn();
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={onOpenChange} />,
    );

    await waitFor(() => screen.getByTestId("scope-agent-hello-world"));

    // Use data-testid to get the specific footer Close button
    const closeBtn = screen.getByTestId("unlinked-modal-close");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ── Datasource/Collection scopes + bulk-add-by-collection ──────────────────

describe("UnlinkedServiceAccountModal — datasource/collection scopes", () => {
  it("offers Datasource and Collection alongside Agent and Tool in the scope-type select", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));
    const typeSelect = screen.getByRole("combobox", { name: /scope type/i });
    const optionLabels = Array.from(typeSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionLabels).toEqual(["Agent", "Tool", "Datasource", "Collection"]);
  });

  it("adds a datasource scope via the Datasource type", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));
    fireEvent.change(screen.getByRole("combobox", { name: /scope type/i }), {
      target: { value: "datasource" },
    });

    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.click(refSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Datasource One" }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "datasource", ref: "ds-1" }),
        }),
      );
    });
  });

  it("adds a collection scope via the Collection type, and shows the search-filter-only note", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));
    fireEvent.change(screen.getByRole("combobox", { name: /scope type/i }), {
      target: { value: "collection" },
    });

    expect(
      screen.getByText(/does not grant access to its member datasources/i),
    ).toBeInTheDocument();

    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.click(refSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "collection", ref: "coll-1" }),
        }),
      );
    });
  });

  it("bulk-adds every grantable datasource from a selected collection via individual POSTs", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    fireEvent.click(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "datasource", ref: "ds-1" }),
        }),
      );
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "datasource", ref: "ds-2" }),
        }),
      );
      expect(
        screen.getByText(/added 2 datasources from the collection/i),
      ).toBeInTheDocument();
    });
    // The non-grantable member id must never be POSTed.
    expect(global.fetch).not.toHaveBeenCalledWith(
      `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
      expect.objectContaining({
        body: JSON.stringify({ type: "datasource", ref: "ds-not-grantable" }),
      }),
    );
  });

  it("excludes datasources already granted to the unlinked SA from the bulk-by-collection add", async () => {
    mockFetch({
      sa: {
        success: true,
        data: { ...ANON_SA, scopes: [...ANON_SA.scopes, { type: "datasource", ref: "ds-1" }] },
      },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    fireEvent.click(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    await waitFor(() => {
      expect(
        screen.getByText(/added 1 datasource from the collection/i),
      ).toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalledWith(
      `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
      expect.objectContaining({
        body: JSON.stringify({ type: "datasource", ref: "ds-1" }),
      }),
    );
  });

  it("shows a note when no datasources in the collection are grantable", async () => {
    mockFetch({
      collectionMembers: { success: true, data: { source_ids: ["ds-not-grantable"] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    fireEvent.click(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    await waitFor(() => {
      expect(
        screen.getByText(/no datasources you can grant are in that collection/i),
      ).toBeInTheDocument();
    });
  });

  it("shows an error note when the collection fetch fails", async () => {
    mockFetch({
      collectionMembers: { success: false, error: "Collection not found" },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    fireEvent.click(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    await waitFor(() => {
      expect(screen.getByText(/collection not found/i)).toBeInTheDocument();
    });
  });

  it("stops the bulk-by-collection loop and surfaces the error on a partial POST failure", async () => {
    const postedRefs: string[] = [];
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method?.toUpperCase() ?? "GET";
      if (href.includes("/api/admin/service-accounts/unlinked")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: ANON_SA }),
        } as Response);
      }
      if (href.includes("/api/admin/service-accounts/grantable")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: GRANTABLE }),
        } as Response);
      }
      if (href.includes("/api/rag/collections/") && method === "GET") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(COLLECTION_MEMBERS),
        } as Response);
      }
      if (href.includes("/scopes") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ref: string };
        postedRefs.push(body.ref);
        if (body.ref === "ds-2") {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({
                success: false,
                error: "You cannot grant a scope you do not hold",
              }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { added: body } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${href} [${method}]`));
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    fireEvent.click(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    await waitFor(() => {
      const errors = screen.getAllByTestId("unlinked-modal-error");
      expect(errors[0]).toHaveTextContent(/cannot grant a scope you do not hold/i);
    });
    // ds-1 succeeded, ds-2 failed and stopped the loop — the non-grantable
    // third member must never even be attempted.
    expect(postedRefs).toEqual(["ds-1", "ds-2"]);
  });

  it("disables the bulk-add picker while a previous pick is still resolving, so a second click cannot double-POST", async () => {
    let resolveCollectionFetch: ((value: unknown) => void) | undefined;
    const pendingCollectionFetch = new Promise((resolve) => {
      resolveCollectionFetch = resolve;
    });
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method?.toUpperCase() ?? "GET";
      if (href.includes("/api/admin/service-accounts/unlinked")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: ANON_SA }),
        } as Response);
      }
      if (href.includes("/api/admin/service-accounts/grantable")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: GRANTABLE }),
        } as Response);
      }
      if (href.includes("/api/rag/collections/") && method === "GET") {
        return pendingCollectionFetch.then(
          () => ({ ok: true, json: () => Promise.resolve(COLLECTION_MEMBERS) } as Response),
        );
      }
      if (href.includes("/scopes") && method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { added: {} } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${href} [${method}]`));
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    const picker = screen.getByRole("combobox", {
      name: /add datasources from a collection/i,
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));

    expect(picker).toBeDisabled();

    resolveCollectionFetch?.(undefined);
    await waitFor(() =>
      expect(screen.getByText(/added 2 datasources from the collection/i)).toBeInTheDocument(),
    );
    expect(picker).not.toBeDisabled();
  });

  it("is idempotent: picking the same collection a second time after the first completes adds nothing new", async () => {
    // A stateful mock is required here: the real regression is that the
    // second pick's exclusion set comes from the SA's scopes as returned by
    // `refresh()` after the first pick applied — a static fixture would mask
    // that and pass even if the exclusion filter were broken.
    let scopes = [...ANON_SA.scopes];
    const postedRefs: string[] = [];
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method?.toUpperCase() ?? "GET";
      if (href.includes("/api/admin/service-accounts/unlinked")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...ANON_SA, scopes } }),
        } as Response);
      }
      if (href.includes("/api/admin/service-accounts/grantable")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: GRANTABLE }),
        } as Response);
      }
      if (href.includes("/api/rag/collections/") && method === "GET") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(COLLECTION_MEMBERS),
        } as Response);
      }
      if (href.includes("/scopes") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { type: string; ref: string };
        postedRefs.push(body.ref);
        scopes = [...scopes, body];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { added: body } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${href} [${method}]`));
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    const picker = screen.getByRole("combobox", {
      name: /add datasources from a collection/i,
    });

    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));
    await waitFor(() =>
      expect(screen.getByText(/added 2 datasources from the collection/i)).toBeInTheDocument(),
    );
    expect(postedRefs).toEqual(["ds-1", "ds-2"]);

    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Collection One" }));
    await waitFor(() =>
      expect(
        screen.getByText(/no datasources you can grant are in that collection/i),
      ).toBeInTheDocument(),
    );

    // Both ds-1 and ds-2 are already granted by the first pick — the second
    // pick must not re-POST either of them.
    expect(postedRefs).toEqual(["ds-1", "ds-2"]);
  });

  it("disables the bulk-add picker when there are no grantable collections", async () => {
    mockFetch({
      grantable: { success: true, data: { ...GRANTABLE, collections: [] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add datasources from a collection/i));
    expect(
      screen.getByRole("combobox", { name: /add datasources from a collection/i }),
    ).toBeDisabled();
  });
});

// ── TEST-11 / UX-5 ─────────────────────────────────────────────────────────

describe("UnlinkedServiceAccountModal — grantable fetch failure (TEST-11/UX-5)", () => {
  it("shows grantable-fetch failure banner when grantable fetch fails (not just empty)", async () => {
    mockFetch({
      grantable: { success: false, error: "Failed to load grantable scopes" },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-error")).toHaveTextContent(
      /failed to load grantable scopes/i,
    );
    // The grantable error banner must be distinct from the SA error banner
    expect(screen.queryByTestId("unlinked-modal-error")).not.toBeInTheDocument();
  });

  it("shows grantable-fetch failure when fetch throws (network error)", async () => {
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/api/admin/service-accounts/unlinked")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: ANON_SA }),
        } as Response);
      }
      if (href.includes("/api/admin/service-accounts/grantable")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.reject(new Error("Unexpected fetch"));
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-error")).toHaveTextContent(
      /network error/i,
    );
  });

  it("UX-5: shows the empty platform-catalog note when grantable is empty (loaded OK)", async () => {
    mockFetch({
      grantable: { success: true, data: { agents: [], tools: [] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-empty-note")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-empty-note")).toHaveTextContent(
      /platform agent resources.*enabled/i,
    );
    // Error banner must not be shown — this is a normal (empty) result, not a failure
    expect(screen.queryByTestId("unlinked-modal-grantable-error")).not.toBeInTheDocument();
  });

  it("does NOT show the limitation note when grantable has items", async () => {
    // Default mockFetch has GRANTABLE with agents
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));
    expect(screen.queryByTestId("unlinked-modal-grantable-empty-note")).not.toBeInTheDocument();
  });
});
