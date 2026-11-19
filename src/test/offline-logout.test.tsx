import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const logoutMock = vi.fn().mockResolvedValue(undefined);
const unsyncedMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: { get: () => Promise.reject({ status: 0, noResponse: true, message: "offline" }), post: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: null, staff_name: "Boss", role: "MANAGER", business_id: "biz-1", business_name: "Ciao" },
    logout: (...a: unknown[]) => logoutMock(...a),
  }),
}));
vi.mock("@/lib/offline/runtime", () => ({
  unsyncedSaleCount: () => unsyncedMock(),
}));

import Profile from "@/pages/Profile";
import { trainingStore } from "@/lib/offline/training";

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  trainingStore.reset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("logout with offline sales", () => {
  it("with nothing unsynced, logs out straight away", async () => {
    unsyncedMock.mockResolvedValue(0);
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });

  it("with unsynced sales it warns and does NOT log out until explicitly confirmed", async () => {
    unsyncedMock.mockResolvedValue(2);
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    expect(await screen.findByText(/2 sales have not reached the server/)).toBeInTheDocument();
    expect(logoutMock).not.toHaveBeenCalled();

    // Cancel keeps the session.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it("default choice keeps the sales; deleting needs a ticked acknowledgement", async () => {
    unsyncedMock.mockResolvedValue(1);
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    const del = await screen.findByRole("button", { name: "Log out and delete them" });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(logoutMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    await waitFor(() => expect(logoutMock).toHaveBeenCalledWith({ discardUnsynced: true }));
  });

  it("keep-on-device logs out without discarding", async () => {
    unsyncedMock.mockResolvedValue(3);
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    fireEvent.click(await screen.findByRole("button", { name: "Log out and keep them on this device" }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledWith({ discardUnsynced: false }));
  });
});

describe("training mode toggle", () => {
  it("is offered to managers/owners and flips the mode", async () => {
    unsyncedMock.mockResolvedValue(0);
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Start training mode" }));
    expect(trainingStore.get().active).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Exit training mode" }));
    expect(trainingStore.get().active).toBe(false);
  });
});
