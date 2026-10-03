-- =====================================================================
-- TRIUMPH IMS · Stage 1 fix: explicit access grants
-- Some Supabase projects do not automatically let signed-in users reach
-- new tables and functions. These grants make that explicit. Row-level
-- security still decides which ROWS each person can see or change.
-- Safe to run more than once.
-- =====================================================================
grant usage on schema public to anon, authenticated;

grant select on public.companies, public.profiles, public.memberships,
                public.invitations, public.audit_log to authenticated;

grant update (name, legal_name, tin, vrn, registration_no, address, phone, email, website,
              base_currency, second_currency, primary_color, accent_color, logo_path,
              bank_details, document_footer)
  on public.companies to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

grant usage on type public.app_role to authenticated;

-- Helper functions used inside the security rules.
grant execute on function
  public.is_member(uuid),
  public.has_role(uuid, public.app_role[]),
  public.is_manager(uuid),
  public.shares_company_with(uuid)
to authenticated;

-- Actions the app calls.
grant execute on function
  public.create_company(text),
  public.invite_member(uuid, text, public.app_role),
  public.revoke_invitation(uuid),
  public.my_invitations(),
  public.accept_invitation(uuid),
  public.update_membership(uuid, public.app_role, boolean)
to authenticated;

-- Make the API notice the new tables straight away.
notify pgrst, 'reload schema';
