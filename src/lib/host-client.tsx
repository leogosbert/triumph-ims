"use client";

import { createContext, useContext } from "react";

/** Client screens: is this the LeMoSp ADMIN address? Set once by the root layout from the request. */
const AdminHostContext = createContext(false);

export function AdminHostProvider({ admin, children }: { admin: boolean; children: React.ReactNode }) {
  return <AdminHostContext.Provider value={admin}>{children}</AdminHostContext.Provider>;
}

export function useAdminHost(): boolean {
  return useContext(AdminHostContext);
}
