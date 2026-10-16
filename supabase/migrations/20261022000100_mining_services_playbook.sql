-- Playbook: Run a mining services company (src/lib/playbooks/mining-services.ts).
-- Only adds a price book row, so it can be requested and granted like the other playbooks.
insert into public.price_items (key, category, name, description, unit, price_tzs, price_usd, level, included_users,
                                feature_keys, playbook_id, requestable, public, sort) values
  ('playbook_mining_services', 'playbook', 'Playbook: Run a mining services company',
   'Supplying mines, equipment hire, drilling by the metre, fabrication and installation, pump and lubrication servicing, tenders and withholding tax.',
   'once', 30000, 12, null, null, '{}', 'mining-services', true, true, 18)
on conflict (key) do nothing;
