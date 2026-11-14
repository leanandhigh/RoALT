import "./executor.css";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { api, type ExecutorStatus } from "../../api";
import { useSetSettings, useSettings } from "../../data";
import { fmtNum, t } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { Switch } from "../../ui/controls";
import { ConfirmDialog, Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Field";
import { CodeEditor } from "../../ui/CodeEditor";
import { Icon } from "../../ui/Icon";
import { StatusPill } from "../../ui/Status";
import { toast, toastError } from "../../ui/Toast";

const KEY = ["executorStatus"];

/** The executor panel: the user's executor program (start, restart, keep open) and its autoexec scripts. */
export function ExecutorView() {
  const qc = useQueryClient();
  const settings = useSettings().data;
  const set = useSetSettings();
  const status = useQuery({ queryKey: KEY, queryFn: api.executorStatus, refetchInterval: 3000 }).data;
  const [busy, setBusy] = useState<"launch" | "restart" | "task" | null>(null);
  const [editing, setEditing] = useState<{ name: string; text: string; isNew: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const put = (s: ExecutorStatus) => qc.setQueryData(KEY, s);

  const choose = async () => {
    const path = await openFile({ multiple: false, directory: false, filters: [{ name: t("executor.program"), extensions: ["exe"] }] });
    if (typeof path !== "string") return;
    set.mutate({ executorExe: path }, { onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
  };
  const launch = (restart: boolean) => {
    setBusy(restart ? "restart" : "launch");
    api
      .executorLaunch(restart)
      .then((s) => {
        put(s);
        toast(t(restart ? "executor.restarted" : "executor.started"));
      }, toastError)
      .finally(() => setBusy(null));
  };
  const addFile = async () => {
    const from = await openFile({ multiple: false, directory: false, filters: [{ name: t("executor.scripts"), extensions: ["lua", "luau", "txt"] }] });
    if (typeof from !== "string") return;
    api.executorScriptAdd(from).then((s) => {
      put(s);
      toast(t("executor.added"));
    }, toastError);
  };
  const edit = (name: string) => api.executorScriptRead(name).then((text) => setEditing({ name, text, isNew: false }), toastError);

  const has = !!status?.path;
  const pill = !has ? null : !status.found ? (
    <StatusPill tone="err" label={t("executor.missing")} />
  ) : status.running ? (
    <StatusPill tone="ok" label={t("executor.running")} />
  ) : (
    <StatusPill tone="info" label={t("executor.stopped")} />
  );

  return (
    <main className="scroll flex-1 min-w-0 page">
      <div className="ex-page">
        <header className="ex-head">
          <h1 className="page-title">{t("app.nav.executor")}</h1>
          <p className="page-sub">{t("executor.sub")}</p>
        </header>

        <section className="ex-card panel">
          <div className="ex-card-head">
            <h2>{t("executor.program")}</h2>
            {pill}
          </div>
          <div className="ex-path">
            <Icon name="code" size={16} />
            <span className="ex-path-text" title={status?.path || undefined}>{status?.path || t("executor.noProgram")}</span>
            <Button size="sm" variant="ghost" onClick={() => void choose()}>
              {has ? t("executor.change") : t("executor.choose")}
            </Button>
          </div>
          <div className="ex-actions">
            <Button variant="primary" size="md" icon="rocket" busy={busy === "launch"} disabled={!status?.found || status.running || !!busy} onClick={() => launch(false)}>
              {t("executor.launch")}
            </Button>
            <Button size="md" icon="refresh" busy={busy === "restart"} disabled={!status?.found || !!busy} onClick={() => launch(true)}>
              {t("executor.restart")}
            </Button>
          </div>
          <div className="ex-admin" data-on={status?.noPrompt || undefined}>
            <span className="min-w-0">
              <b>{t(status?.noPrompt ? "executor.noPromptOn" : "executor.noPrompt")}</b>
              <span>{t(status?.noPrompt ? "executor.noPromptOnHint" : "executor.noPromptHint")}</span>
            </span>
            {!status?.noPrompt && (
              <Button
                size="sm"
                icon="shield"
                busy={busy === "task"}
                disabled={!status?.found || !!busy}
                onClick={() => {
                  setBusy("task");
                  api
                    .executorTaskSetup()
                    .then((s) => {
                      put(s);
                      toast(t("executor.noPromptDone"));
                    }, toastError)
                    .finally(() => setBusy(null));
                }}
              >
                {t("executor.noPromptSetUp")}
              </Button>
            )}
          </div>
          <div className="ex-toggles">
            <label className="ex-toggle">
              <span>
                <b>{t("executor.autoOpen")}</b>
                <span>{t("executor.autoOpenHint")}</span>
              </span>
              <Switch label={t("executor.autoOpen")} checked={!!settings?.executorAutoOpen} disabled={!has} onChange={(on) => set.mutate({ executorAutoOpen: on })} />
            </label>
            <label className="ex-toggle">
              <span>
                <b>{t("executor.keepOpen")}</b>
                <span>{t("executor.keepOpenHint")}</span>
              </span>
              <Switch label={t("executor.keepOpen")} checked={!!settings?.executorKeepOpen} disabled={!has} onChange={(on) => set.mutate({ executorKeepOpen: on })} />
            </label>
          </div>
        </section>

        <section className="ex-card panel">
          <div className="ex-card-head">
            <h2>{t("executor.autoexec")}</h2>
            <div className="ex-card-tools">
              <Button size="sm" variant="ghost" icon="plus" disabled={!has} onClick={() => setEditing({ name: "", text: "", isNew: true })}>
                {t("executor.newScript")}
              </Button>
              <Button size="sm" icon="download" disabled={!has} onClick={() => void addFile()}>
                {t("executor.addFile")}
              </Button>
            </div>
          </div>
          {status?.autoexecDir ? (
            <button type="button" className="ex-folder" onClick={() => api.executorFolderOpen().catch(toastError)} data-tip={t("executor.openFolder")}>
              <Icon name="folder" size={14} />
              <span>{status.autoexecDir}</span>
            </button>
          ) : (
            <p className="ex-empty">{t("executor.chooseFirst")}</p>
          )}
          {has && (
            <ul className="ex-files">
              {status.files.map((f) => (
                <li key={f.name} className="ex-file">
                  <Icon name="file" size={16} />
                  <button type="button" className="ex-file-name" onClick={() => void edit(f.name)}>
                    <span>{f.name}</span>
                    <span className="ex-file-size">{fmtSize(f.size)}</span>
                  </button>
                  <IconButton size="sm" icon="pencil" label={t("executor.edit")} onClick={() => void edit(f.name)} />
                  <IconButton size="sm" icon="trash" label={t("executor.delete")} onClick={() => setRemoving(f.name)} />
                </li>
              ))}
              {!status.files.length && <li className="ex-empty">{t("executor.noScripts")}</li>}
            </ul>
          )}
        </section>
      </div>

      <ScriptEditor
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={(s) => {
          put(s);
          setEditing(null);
          toast(t("executor.saved"));
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={t("executor.deleteTitle", { name: removing ?? "" })}
        text={t("executor.deleteBody")}
        confirmLabel={t("executor.delete")}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const name = removing!;
          setRemoving(null);
          api.executorScriptDelete(name).then(put, toastError);
        }}
      />
    </main>
  );
}

function fmtSize(b: number) {
  return b < 1024 ? `${fmtNum(b)} B` : `${fmtNum(Math.round(b / 102.4) / 10)} KB`;
}

function ScriptEditor({ value, onClose, onSaved }: {
  value: { name: string; text: string; isNew: boolean } | null;
  onClose: () => void;
  onSaved: (s: ExecutorStatus) => void;
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState<typeof value>(null);
  const [saving, setSaving] = useState(false);
  if (value !== from) {
    setFrom(value);
    setName(value?.name ?? "");
    setText(value?.text ?? "");
  }
  const save = () => {
    let n = name.trim();
    if (!n) return toast(t("executor.needName"), "error");
    if (!/\.(lua|luau|txt)$/i.test(n)) n += ".lua";
    setSaving(true);
    api
      .executorScriptWrite(n, text)
      .then(onSaved, toastError)
      .finally(() => setSaving(false));
  };
  return (
    <Dialog open={value !== null} onClose={onClose} title={value?.isNew ? t("executor.newScript") : t("executor.edit")} width={820}>
      <div className="ex-editor">
        {value?.isNew && (
          <Input leading="file" value={name} onChange={(e) => setName(e.target.value)} placeholder="autofarm.lua" aria-label={t("executor.fileName")} autoFocus />
        )}
        <CodeEditor
          value={text}
          onChange={setText}
          label={t("executor.script")}
          name={value?.isNew ? name.trim() || "autofarm.lua" : value?.name}
          onSave={save}
          minRows={18}
          autoFocus={!value?.isNew}
        />
        <div className="ex-editor-acts">
          <span className="meta me-auto">{t("executor.saveHint")}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" busy={saving} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
