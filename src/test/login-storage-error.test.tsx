import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { SafeStorageError } from "@/lib/safe-storage";

/**
 * Regression coverage for the "a storage throw looks like a wrong PIN" bug.
 *
 * Before this fix, `storeTokens`/`storeUser` called `localStorage` directly
 * with no try/catch. A throw there (Safari on iPad under storage
 * partitioning, private browsing, etc.) propagated out of `login()` and was
 * caught by Login.tsx's generic catch block, which showed "Incorrect PIN.
 * Please try again." for ANY error shape without a `message` — and even for
 * ones that had a technical browser `message`, never anything that told the
 * cashier it wasn't their PIN. `login()` can now reject with a
 * `SafeStorageError` instead (after the in-memory fallback itself somehow
 * also fails, which is the only case that still propagates), and Login.tsx
 * must show *that* error's own message, not the PIN fallback.
 */

const STAFF_DIR = {
  business_name: "The Burger Joint",
  staff: [{ id: "staff-1", staff_name: "Alice" }],
};

vi.mock("@/lib/api", () => ({
  fetchStaffDirectory: vi.fn(() => Promise.resolve(STAFF_DIR)),
}));

const loginMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    login: loginMock,
    savedBusiness: null,
    changeStore: vi.fn(),
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import Login from "@/pages/Login";

function renderLogin() {
  return render(
    <MemoryRouter>
      <TouchKeyboardProvider>
        <Login />
      </TouchKeyboardProvider>
    </MemoryRouter>
  );
}

async function enterStoreCodeAndSelectStaff() {
  const codeInput = screen.getByLabelText("Store Code");
  fireEvent.change(codeInput, { target: { value: "ONU9XE" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  const staffButton = await screen.findByRole("button", { name: "Alice" });
  fireEvent.click(staffButton);
}

async function enterPin() {
  for (const digit of ["1", "2", "3", "4"]) {
    fireEvent.click(screen.getByRole("button", { name: digit }));
  }
}

describe("Login — distinguishes a storage failure from a wrong PIN", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the normal 'Incorrect PIN' fallback for a genuine login rejection without a message", async () => {
    loginMock.mockRejectedValueOnce({});
    renderLogin();

    await enterStoreCodeAndSelectStaff();
    await enterPin();

    await waitFor(() => {
      expect(screen.getByText("Incorrect PIN. Please try again.")).toBeInTheDocument();
    });
  });

  it("shows the SafeStorageError's own message, never 'Incorrect PIN', when login() rejects because storage failed", async () => {
    loginMock.mockRejectedValueOnce(new SafeStorageError());
    renderLogin();

    await enterStoreCodeAndSelectStaff();
    await enterPin();

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't save data on this device. Please try again.")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Incorrect PIN. Please try again.")).not.toBeInTheDocument();
  });

  it("ordinary login still navigates to /welcome on success (regression)", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    renderLogin();

    await enterStoreCodeAndSelectStaff();
    await enterPin();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/welcome", { replace: true });
    });
  });
});
