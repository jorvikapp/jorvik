import React, { useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    defaultChannelImportConfig,
    getSupportedChannels,
    parseJsonExport,
    runJsonImport,
    type ChannelImportConfig,
    type JsonExport,
    type JsonExportChannel,
    type ImportProgress,
    type ImportResult,
    type ImportSignal,
} from "../../adapters/importJsonAdapter";
import {
    DiscordTemplateError,
    discordTemplateToImport,
    fetchDiscordTemplate,
    parseDiscordTemplateCode,
} from "../../adapters/discordTemplateAdapter";
import { RoomDialog } from "./RoomDialog";

/** Where an import comes from: a Discord server's template link, or a JSON export file. */
export type ImportSource = "discord" | "json";

interface ImportJsonWizardProps {
    client: MatrixClient;
    open: boolean;
    source: ImportSource;
    onClose: () => void;
    onImported: (spaceId: string) => void;
}

type WizardStep = "select" | "configure" | "importing" | "done";

// Synapse lets an account make 10 rooms at once, then about one a minute. An import makes a room for the Space and
// one for each channel.
const ROOMS_AT_ONCE = 10;

function ImportChannelRow({
    channel,
    config,
    onChange,
}: {
    channel: JsonExportChannel;
    config: ChannelImportConfig;
    onChange: (val: ChannelImportConfig) => void;
}): React.ReactElement {
    const isVoice = channel.type === "voice";
    const icon = isVoice ? "🔊" : "#";
    return (
        <div className="import-tree-channel">
            <span className="import-tree-channel-icon">{icon}</span>
            <span className="import-tree-channel-name">{channel.name}</span>
            <div className="import-tree-channel-controls">
                <select
                    className="import-tree-channel-select"
                    aria-label={`Who can join ${channel.name}`}
                    value={config.isPublic ? "public" : "invite"}
                    onChange={(e) => onChange({ ...config, isPublic: e.target.value === "public" })}
                >
                    <option value="public">Anyone can join</option>
                    <option value="invite">Invite only</option>
                </select>
                <select
                    className="import-tree-channel-select"
                    aria-label={`Encryption for ${channel.name}`}
                    value={config.isEncrypted ? "enc" : "plain"}
                    onChange={(e) => onChange({ ...config, isEncrypted: e.target.value === "enc" })}
                >
                    <option value="enc">Encrypted</option>
                    <option value="plain">Not encrypted</option>
                </select>
                {/* Voice channels have no chat to post in. Hidden rather than left out, so the rows line up. */}
                <select
                    className={`import-tree-channel-select${isVoice ? " is-hidden" : ""}`}
                    aria-label={`Who can post in ${channel.name}`}
                    aria-hidden={isVoice || undefined}
                    tabIndex={isVoice ? -1 : undefined}
                    value={config.minPL}
                    onChange={(e) => onChange({ ...config, minPL: Number(e.target.value) as 0 | 50 | 100 })}
                >
                    <option value={0}>Anyone can post</option>
                    <option value={50}>Only mods post</option>
                    <option value={100}>Only admins post</option>
                </select>
            </div>
        </div>
    );
}

export function ImportJsonWizard({
    client,
    open,
    source,
    onClose,
    onImported,
}: ImportJsonWizardProps): React.ReactElement | null {
    const [step, setStep] = useState<WizardStep>("select");
    const [exportData, setExportData] = useState<JsonExport | null>(null);
    const [emojiFiles, setEmojiFiles] = useState<Map<string, File>>(new Map());
    const [parseError, setParseError] = useState<string | null>(null);
    const [progress, setProgress] = useState<ImportProgress | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [channelConfig, setChannelConfig] = useState<Record<string, ChannelImportConfig>>({});
    const [templateLink, setTemplateLink] = useState("");
    // The code of the template in exportData, so going back and on again keeps the changes made to it.
    const [templateCode, setTemplateCode] = useState<string | null>(null);
    const [loadingTemplate, setLoadingTemplate] = useState(false);

    const jsonInputRef = useRef<HTMLInputElement>(null);
    const emojiInputRef = useRef<HTMLInputElement>(null);
    const signalRef = useRef<ImportSignal>({ cancelled: false });
    // Counts requests for templates, so an answer that comes after the wizard was closed or asked again is ignored.
    const templateRequestRef = useRef(0);

    const resetState = (): void => {
        setStep("select");
        setExportData(null);
        setEmojiFiles(new Map());
        setParseError(null);
        setProgress(null);
        setResult(null);
        setChannelConfig({});
        setTemplateLink("");
        setTemplateCode(null);
        setLoadingTemplate(false);
        templateRequestRef.current += 1;
    };

    const handleClose = (): void => {
        if (step === "importing" && !signalRef.current.cancelled) return;
        resetState();
        onClose();
    };

    const handleJsonFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (): void => {
            try {
                const parsed = parseJsonExport(JSON.parse(reader.result as string));
                if (!parsed) {
                    setParseError("That file isn't a server export Jorvik can read.");
                    setExportData(null);
                } else {
                    setParseError(null);
                    setExportData(parsed);
                }
            } catch {
                setParseError("That file isn't valid JSON.");
                setExportData(null);
            }
        };
        reader.readAsText(file);
    };

    const handleEmojiFolder = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;
        if (!files) return;

        const map = new Map<string, File>();
        for (const file of Array.from(files)) {
            const filename = file.name.split("/").pop() ?? file.name;
            if (/\.(png|gif|webp|jpe?g)$/i.test(filename)) {
                map.set(filename, file);
            }
        }
        setEmojiFiles(map);
    };

    const loadTemplate = async (): Promise<void> => {
        const code = parseDiscordTemplateCode(templateLink);
        if (!code) {
            setParseError("That isn't a Discord template link. Template links start with https://discord.new/");
            return;
        }
        if (code === templateCode && exportData) {
            setStep("configure");
            return;
        }

        const request = ++templateRequestRef.current;
        setLoadingTemplate(true);
        setParseError(null);
        try {
            const imported = discordTemplateToImport(await fetchDiscordTemplate(code));
            if (request !== templateRequestRef.current) return;
            setExportData(imported.exportData);
            setChannelConfig(imported.channelConfig);
            setTemplateCode(code);
            setStep("configure");
        } catch (err) {
            if (request !== templateRequestRef.current) return;
            setParseError(err instanceof DiscordTemplateError ? err.message : "Couldn't read the template. Try again.");
        } finally {
            if (request === templateRequestRef.current) setLoadingTemplate(false);
        }
    };

    const startImport = async (): Promise<void> => {
        if (!exportData) return;
        signalRef.current = { cancelled: false };
        setStep("importing");
        try {
            const importResult = await runJsonImport(
                client,
                exportData,
                emojiFiles,
                (prog) => { setProgress({ ...prog }); },
                signalRef.current,
                channelConfig,
            );
            setResult(importResult);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unexpected error during import.";
            setResult({ spaceId: "", channelsCreated: 0, emojisUploaded: 0, errors: [msg] });
        }
        setStep("done");
    };

    const cancelImport = (): void => {
        signalRef.current.cancelled = true;
    };

    const supportedChannels = exportData ? getSupportedChannels(exportData) : [];
    const textChannelCount = supportedChannels.filter((ch) => ch.type === "text").length;
    const voiceChannelCount = supportedChannels.filter((ch) => ch.type === "voice").length;
    const emojiOkCount = exportData ? exportData.emojis.filter((e) => e.status === "ok").length : 0;
    const emojiReadyCount = exportData
        ? exportData.emojis.filter((e) => e.status === "ok" && emojiFiles.has(e.path.split("/").pop() ?? "")).length
        : 0;
    const minutesToWait = Math.max(0, supportedChannels.length + 1 - ROOMS_AT_ONCE);

    const progressPercent =
        progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    const getTitle = (): string => {
        switch (step) {
            case "select": return source === "discord" ? "Import from Discord" : "Import from a JSON file";
            case "configure": return "Check the channels";
            case "importing": return "Importing...";
            case "done": return result?.spaceId ? "Import complete" : "Import failed";
        }
    };

    const renderSummary = (): React.ReactElement | null => {
        if (!exportData) return null;
        return (
            <div className="import-wizard-summary">
                <p className="import-wizard-summary-name">{exportData.guild.name}</p>
                <p className="room-dialog-muted">
                    {exportData.categories.length} categories &middot; {textChannelCount} text &middot;{" "}
                    {voiceChannelCount} voice
                    {source === "json" ? <> &middot; {emojiOkCount} emoji</> : null}
                </p>
            </div>
        );
    };

    const renderFooter = (): React.ReactElement => {
        if (step === "select") {
            return (
                <>
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={handleClose}>
                        Cancel
                    </button>
                    {source === "discord" ? (
                        <button
                            type="button"
                            className="room-dialog-button room-dialog-button-primary"
                            onClick={() => void loadTemplate()}
                            disabled={!templateLink.trim() || loadingTemplate}
                        >
                            {loadingTemplate ? "Loading..." : "Next"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="room-dialog-button room-dialog-button-primary"
                            onClick={() => setStep("configure")}
                            disabled={!exportData}
                        >
                            Next
                        </button>
                    )}
                </>
            );
        }

        if (step === "configure") {
            return (
                <>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-secondary"
                        onClick={() => setStep("select")}
                    >
                        Back
                    </button>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-primary"
                        onClick={() => void startImport()}
                    >
                        Start import
                    </button>
                </>
            );
        }

        if (step === "importing") {
            return (
                <button
                    type="button"
                    className="room-dialog-button room-dialog-button-secondary"
                    onClick={cancelImport}
                >
                    Cancel
                </button>
            );
        }

        if (step === "done") {
            return (
                <button
                    type="button"
                    className="room-dialog-button room-dialog-button-primary"
                    onClick={() => {
                        if (result?.spaceId) onImported(result.spaceId);
                        handleClose();
                    }}
                >
                    {result?.spaceId ? "Go to Space" : "Close"}
                </button>
            );
        }

        return <></>;
    };

    return (
        <RoomDialog open={open} title={getTitle()} onClose={handleClose} footer={renderFooter()}>
            {step === "select" && source === "discord" && (
                <div className="import-wizard-step">
                    <p className="room-dialog-muted">
                        Copy a Discord server's categories and channels into a new Space, along with who can see and
                        post in each channel. Messages, members and emoji stay on Discord.
                    </p>
                    <ol className="import-wizard-list">
                        <li>In Discord, open Server Settings and choose Server Template. You need to own the server or be able to manage it.</li>
                        <li>Make a template, or sync the one you have so it's up to date, and copy its link.</li>
                        <li>Paste the link here.</li>
                    </ol>

                    <label className="room-dialog-field">
                        <span>Template link</span>
                        <input
                            type="text"
                            value={templateLink}
                            onChange={(event) => {
                                setTemplateLink(event.target.value);
                                setParseError(null);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && templateLink.trim() && !loadingTemplate) void loadTemplate();
                            }}
                            placeholder="https://discord.new/..."
                            autoComplete="off"
                            spellCheck={false}
                            className="room-dialog-input"
                        />
                    </label>

                    {parseError && <p className="room-dialog-error">{parseError}</p>}

                    <p className="room-dialog-muted">Discord leaves announcement, forum and stage channels out of templates.</p>
                </div>
            )}

            {step === "select" && source === "json" && (
                <div className="import-wizard-step">
                    <p className="room-dialog-muted">
                        Choose the JSON export file, and the folder of emoji images if you have one.
                    </p>

                    <label className="room-dialog-field">
                        <span>JSON export file</span>
                        <input
                            ref={jsonInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleJsonFile}
                            className="room-dialog-input"
                        />
                    </label>

                    {parseError && <p className="room-dialog-error">{parseError}</p>}

                    {renderSummary()}

                    <label className="room-dialog-field">
                        <span>Emoji folder (optional)</span>
                        <input
                            ref={emojiInputRef}
                            type="file"
                            accept="image/*"
                            // @ts-expect-error -- webkitdirectory not in standard TS types
                            webkitdirectory=""
                            onChange={handleEmojiFolder}
                            className="room-dialog-input"
                        />
                    </label>

                    {emojiFiles.size > 0 && (
                        <p className="room-dialog-muted">{emojiFiles.size} emoji image(s) loaded.</p>
                    )}
                </div>
            )}

            {step === "configure" && exportData && (
                <div className="import-wizard-step">
                    {source === "discord" ? (
                        <>
                            {renderSummary()}
                            <p className="room-dialog-muted">
                                Each channel is set up to match who could see it and post in it on Discord. Change
                                anything you like before you import.
                            </p>
                        </>
                    ) : (
                        <p className="room-dialog-muted">
                            Choose who can join each channel, whether it's encrypted, and who can post in it.
                            {emojiOkCount > 0 && (
                                <>
                                    {" "}
                                    {emojiReadyCount > 0
                                        ? `${emojiReadyCount} of ${emojiOkCount} emoji will be uploaded.`
                                        : `Choose the emoji folder to upload the ${emojiOkCount} emoji too.`}
                                </>
                            )}
                        </p>
                    )}
                    <div className="import-tree">
                        {(() => {
                            const catIds = new Set(exportData.categories.map((c) => c.id));
                            const uncategorized = getSupportedChannels(exportData)
                                .filter((ch) => !ch.category_id || !catIds.has(ch.category_id))
                                .sort((a, b) => a.position - b.position);
                            return uncategorized.map((ch) => (
                                <ImportChannelRow
                                    key={ch.id}
                                    channel={ch}
                                    config={channelConfig[ch.id] ?? defaultChannelImportConfig()}
                                    onChange={(val) => setChannelConfig((prev) => ({ ...prev, [ch.id]: val }))}
                                />
                            ));
                        })()}
                        {[...exportData.categories]
                            .sort((a, b) => a.position - b.position)
                            .map((cat) => {
                                const channels = getSupportedChannels(exportData)
                                    .filter((ch) => ch.category_id === cat.id)
                                    .sort((a, b) => a.position - b.position);
                                if (channels.length === 0) return null;
                                return (
                                    <div key={cat.id} className="import-tree-category">
                                        <div className="import-tree-category-name">{cat.name}</div>
                                        {channels.map((ch) => (
                                            <ImportChannelRow
                                                key={ch.id}
                                                channel={ch}
                                                config={channelConfig[ch.id] ?? defaultChannelImportConfig()}
                                                onChange={(val) =>
                                                    setChannelConfig((prev) => ({ ...prev, [ch.id]: val }))
                                                }
                                            />
                                        ))}
                                    </div>
                                );
                            })}
                    </div>
                    <p className="room-dialog-muted" style={{ marginTop: 8 }}>
                        Everyone in the Space can join the channels anyone can join. Invite people to the invite-only
                        ones after the import.
                    </p>
                    {minutesToWait > 0 && (
                        <p className="room-dialog-muted">
                            Your server may only let you make about one channel a minute after the first ten, so this
                            could take {minutesToWait === 1 ? "about a minute" : `about ${minutesToWait} minutes`}. Keep
                            Jorvik open until it's done.
                        </p>
                    )}
                </div>
            )}

            {step === "importing" && (
                <div className="import-wizard-step">
                    <p className="import-wizard-progress-message">{progress?.message ?? "Starting..."}</p>
                    <div className="import-wizard-progressbar">
                        <div className="import-wizard-progressbar-fill" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <p className="room-dialog-muted">{progressPercent}%</p>
                </div>
            )}

            {step === "done" && result && (
                <div className="import-wizard-step">
                    {result.spaceId ? (
                        <>
                            <p className="import-wizard-success">Your Space is ready.</p>
                            <ul className="import-wizard-list">
                                <li>Channels created: {result.channelsCreated}</li>
                                {source === "json" ? <li>Emoji uploaded: {result.emojisUploaded}</li> : null}
                            </ul>
                            {source === "discord" ? (
                                <>
                                    <p className="room-dialog-muted">Still to do, in the Space's Server Settings:</p>
                                    <ul className="import-wizard-list">
                                        <li>Add the server's picture under Overview, and its emoji under Emoji.</li>
                                        <li>Bring people over: invite them, or let anyone join under Visibility.</li>
                                    </ul>
                                </>
                            ) : null}
                        </>
                    ) : (
                        <p className="room-dialog-error">The import didn't work.</p>
                    )}
                    {result.errors.length > 0 && (
                        <details className="import-wizard-errors">
                            <summary className="room-dialog-muted">
                                {result.errors.length === 1 ? "1 thing didn't work" : `${result.errors.length} things didn't work`}
                            </summary>
                            <ul className="import-wizard-error-list">
                                {result.errors.map((e, i) => (
                                    <li key={i}>{e}</li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </RoomDialog>
    );
}
