import { useEffect, useState } from "react";
import { client, type Organization, type Person } from "../lib/api";

type Section = "contatos" | "empresas";

export function People() {
  const [section, setSection] = useState<Section>("contatos");
  const [items, setItems] = useState<Person[] | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [relation, setRelation] = useState("");
  const [tags, setTags] = useState("");
  const [isClient, setIsClient] = useState(false);
  const [vip, setVip] = useState(false);
  const [roleTitle, setRoleTitle] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);

  const [orgName, setOrgName] = useState("");
  const [orgNote, setOrgNote] = useState("");
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);

  async function reloadPeople() {
    try {
      const res = await client.people();
      setItems(res.items);
      setError(null);
    } catch {
      setError("Falha ao carregar contatos.");
      setItems([]);
    }
  }

  async function reloadOrgs() {
    try {
      const res = await client.organizations();
      setOrgs(res.items);
      setOrgsError(null);
    } catch {
      setOrgs([]);
      setOrgsError("Empresas indisponíveis no momento.");
    }
  }

  useEffect(() => {
    void reloadPeople();
    void reloadOrgs();
  }, []);

  function openFicha(p: Person) {
    setActive(p);
    setName(p.name || "");
    setNote(p.note || "");
    setRelation(p.relation || "");
    setTags((p.tags || []).join(", "));
    setIsClient(p.kind === "client");
    setVip(Boolean(p.vip));
    setRoleTitle(p.role_title || "");
    setOrganizationId(p.organization_id || "");
  }

  function closeFicha() {
    setActive(null);
  }

  async function saveFicha() {
    if (!active) return;
    setSaving(true);
    try {
      await client.patchPerson(active.id, {
        name: name.trim() || undefined,
        note: note.trim(),
        relation: relation.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        kind: isClient ? "client" : active.kind === "client" ? "contact" : active.kind,
        roleTitle: roleTitle.trim(),
        vip,
        organizationId: organizationId || null,
      });
      closeFicha();
      await reloadPeople();
    } catch {
      setError("Não deu para salvar o contato.");
    } finally {
      setSaving(false);
    }
  }

  async function createOrg() {
    const n = orgName.trim();
    if (!n) return;
    setSavingOrg(true);
    try {
      await client.createOrganization({ name: n, note: orgNote.trim() });
      setOrgName("");
      setOrgNote("");
      await reloadOrgs();
    } catch {
      setOrgsError("Não deu para criar a empresa.");
    } finally {
      setSavingOrg(false);
    }
  }

  async function saveOrgEdit() {
    if (!editingOrg) return;
    setSavingOrg(true);
    try {
      await client.patchOrganization(editingOrg.id, {
        name: orgName.trim() || editingOrg.name,
        note: orgNote.trim(),
      });
      setEditingOrg(null);
      setOrgName("");
      setOrgNote("");
      await reloadOrgs();
    } catch {
      setOrgsError("Não deu para salvar a empresa.");
    } finally {
      setSavingOrg(false);
    }
  }

  async function fixData() {
    setFixing(true);
    try {
      const r = await client.fixOrgs();
      await Promise.all([reloadPeople(), reloadOrgs()]);
      alert(
        `Limpeza: ${r.merged} empresa(s) mesclada(s), ${r.renamed} renomeada(s), ${r.peopleFixed} ficha(s) com acento corrigido.`,
      );
    } catch {
      setError("Falha ao limpar empresas/acentos.");
    } finally {
      setFixing(false);
    }
  }

  async function purgeAgent() {
    setFixing(true);
    try {
      const r = await client.purgeAgentPeers();
      await reloadPeople();
      alert(
        `Secretaria: ${r.markedAgent} marcados; ${r.clearedBriefs} fichamentos limpos.`,
      );
    } catch {
      setError("Falha ao limpar conversas do agente.");
    } finally {
      setFixing(false);
    }
  }

  if (!items) return <p className="boot">Carregando contatos…</p>;

  return (
    <div className="ms-page contacts-page">
      {error ? <p className="form-error">{error}</p> : null}

      <div className="section-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={section === "contatos" ? "active" : undefined}
          aria-selected={section === "contatos"}
          onClick={() => setSection("contatos")}
        >
          Contatos
        </button>
        <button
          type="button"
          role="tab"
          className={section === "empresas" ? "active" : undefined}
          aria-selected={section === "empresas"}
          onClick={() => setSection("empresas")}
        >
          Empresas
        </button>
      </div>

      {section === "empresas" ? (
        <section className="ms-dash-panel">
          <header>
            <div>
              <h3>Empresas</h3>
              <p className="muted">Cadastre e vincule na ficha do contato</p>
            </div>
            <button
              type="button"
              className="btn-quiet btn-sm"
              disabled={fixing}
              onClick={() => void fixData()}
            >
              {fixing ? "Limpando…" : "Limpar duplicatas"}
            </button>
          </header>
          <div className="panel-body">
            {orgsError ? <p className="form-error">{orgsError}</p> : null}
            <div className="org-create">
              <label className="field">
                <span>{editingOrg ? "Editar nome" : "Nova empresa"}</span>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ecommtábil"
                />
              </label>
              <label className="field">
                <span>Nota</span>
                <input
                  value={orgNote}
                  onChange={(e) => setOrgNote(e.target.value)}
                  placeholder="Cliente piloto…"
                />
              </label>
              <div className="row-actions">
                {editingOrg ? (
                  <>
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => {
                        setEditingOrg(null);
                        setOrgName("");
                        setOrgNote("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={savingOrg || !orgName.trim()}
                      onClick={() => void saveOrgEdit()}
                    >
                      {savingOrg ? "Salvando…" : "Salvar empresa"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={savingOrg || !orgName.trim()}
                    onClick={() => void createOrg()}
                  >
                    {savingOrg ? "Criando…" : "Criar empresa"}
                  </button>
                )}
              </div>
            </div>
            {orgs.length === 0 ? (
              <p className="muted panel-empty">Nenhuma empresa ainda.</p>
            ) : (
              <ul className="ms-dash-list flush">
                {orgs.map((o) => (
                  <li key={o.id}>
                    <div>
                      <strong>{o.name}</strong>
                      <span>
                        {o.people_count ?? 0} pessoa(s)
                        {o.note ? ` · ${o.note}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-quiet btn-sm"
                      onClick={() => {
                        setEditingOrg(o);
                        setOrgName(o.name);
                        setOrgNote(o.note || "");
                      }}
                    >
                      Editar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : (
        <section className="ms-dash-panel">
          <header>
            <div>
              <h3>Contatos</h3>
              <p className="muted">
                {items.length} pessoas — Cliente e VIP são marcas separadas
              </p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn-quiet btn-sm"
                disabled={fixing}
                onClick={() => void fixData()}
              >
                {fixing ? "Limpando…" : "Corrigir acentos"}
              </button>
              <button
                type="button"
                className="btn-quiet btn-sm"
                disabled={fixing}
                onClick={() => void purgeAgent()}
              >
                Limpar Secretaria
              </button>
            </div>
          </header>
          <div className="panel-body tight">
            {items.length === 0 ? (
              <p className="muted panel-empty">Ainda sem contatos — entram quando o WhatsApp fala.</p>
            ) : (
              <ul className="ms-dash-list flush">
                {items.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="ms-dash-open" onClick={() => openFicha(p)}>
                      <strong>{p.name || p.phone}</strong>
                      <span>
                        {p.phone}
                        {p.organization_name
                          ? ` · ${p.role_title ? `${p.role_title} · ` : ""}${p.organization_name}`
                          : p.relation
                            ? ` · ${p.relation}`
                            : ""}
                      </span>
                      <span className="tag-row">
                        {p.kind === "client" ? (
                          <span className="tag tag-client">cliente</span>
                        ) : null}
                        {p.vip ? <span className="tag tag-vip">VIP</span> : null}
                        {(p.tags || []).map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </span>
                      {p.note ? <span className="muted">{p.note}</span> : null}
                    </button>
                    <button type="button" className="btn-quiet btn-sm" onClick={() => openFicha(p)}>
                      Ficha
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {active ? (
        <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Ficha do contato">
          <button type="button" className="drawer-scrim" aria-label="Fechar" onClick={closeFicha} />
          <aside className="drawer-panel">
            <header className="drawer-head">
              <div>
                <h3>Ficha</h3>
                <p>{active.name || active.phone}</p>
              </div>
              <button type="button" className="btn-quiet btn-sm" onClick={closeFicha}>
                Fechar
              </button>
            </header>
            <div className="drawer-body">
              <label className="field">
                <span>Nome</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <div className="mark-toggles">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={isClient}
                    onChange={(e) => setIsClient(e.target.checked)}
                  />
                  <span>Cliente</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={vip} onChange={(e) => setVip(e.target.checked)} />
                  <span>VIP</span>
                </label>
              </div>
              <p className="field-hint muted">
                Cliente = relação comercial. VIP = prioridade de aviso.
              </p>

              <label className="field">
                <span>Empresa</span>
                <select
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                >
                  <option value="">— sem empresa —</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Cargo na empresa</span>
                <input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="funcionário, dono, sócio…"
                />
              </label>
              <label className="field">
                <span>Relação</span>
                <input
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  placeholder="sócio, fornecedor…"
                />
              </label>
              <label className="field">
                <span>Nota</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Blurb curto — o que ajuda a decidir"
                />
              </label>
              <label className="field">
                <span>Tags (vírgula)</span>
                <input value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
            </div>
            <footer className="drawer-foot">
              <button type="button" className="btn-quiet" onClick={closeFicha}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={() => void saveFicha()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
