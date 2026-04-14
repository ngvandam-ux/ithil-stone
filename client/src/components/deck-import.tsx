import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Link2,
  Upload,
  Loader2,
  FileText,
  X,
  ExternalLink,
} from "lucide-react";

interface DeckImportProps {
  onImport: (data: { deckName: string; format: string; decklist: string }) => void;
}

type ImportTab = "url" | "file";

export default function DeckImport({ onImport }: DeckImportProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ImportTab>("url");
  const [url, setUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL import mutation
  const urlMutation = useMutation({
    mutationFn: async (deckUrl: string) => {
      const res = await apiRequest("POST", "/api/import-url", { url: deckUrl });
      return res.json();
    },
    onSuccess: (data) => {
      onImport(data);
      setUrl("");
      toast({ title: "Forces marshalled", description: `"${data.deckName}" has been revealed to the stone.` });
    },
    onError: (err: Error) => {
      toast({
        title: "The vision is clouded",
        description: "The stone could not read this scroll. Supported: Moxfield, Archidekt, MTGGoldfish.",
        variant: "destructive",
      });
    },
  });

  // File import mutation
  const fileMutation = useMutation({
    mutationFn: async ({ content, filename }: { content: string; filename: string }) => {
      const res = await apiRequest("POST", "/api/import-file", { content, filename });
      return res.json();
    },
    onSuccess: (data) => {
      onImport(data);
      setSelectedFile(null);
      toast({ title: "Scroll deciphered", description: `"${data.deckName}" has been revealed to the stone.` });
    },
    onError: () => {
      toast({
        title: "Runes unreadable",
        description: "The stone cannot decipher this scroll. Try .txt, .dek, or .dec format.",
        variant: "destructive",
      });
    },
  });

  const handleUrlImport = () => {
    if (!url.trim()) return;
    urlMutation.mutate(url.trim());
  };

  const processFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (content) {
          fileMutation.mutate({ content, filename: file.name });
        }
      };
      reader.readAsText(file);
    },
    [fileMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const isLoading = urlMutation.isPending || fileMutation.isPending;

  return (
    <div className="space-y-3" data-testid="deck-import">
      {/* Tab switcher */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50 w-fit">
        <button
          onClick={() => setTab("url")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tab === "url"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-url"
        >
          <Link2 className="w-3 h-3" />
          Scry URL
        </button>
        <button
          onClick={() => setTab("file")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tab === "file"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-file"
        >
          <Upload className="w-3 h-3" />
          Upload Scroll
        </button>
      </div>

      {/* URL import */}
      {tab === "url" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Paste a Moxfield, Archidekt, or MTGGoldfish URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUrlImport()}
              className="h-9 text-sm"
              data-testid="input-import-url"
            />
            <Button
              size="sm"
              onClick={handleUrlImport}
              disabled={isLoading || !url.trim()}
              className="h-9 px-4 shrink-0"
              data-testid="button-import-url"
            >
              {urlMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Scry"
              )}
            </Button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <ExternalLink className="w-2.5 h-2.5" />
              Moxfield
            </span>
            <span className="flex items-center gap-1">
              <ExternalLink className="w-2.5 h-2.5" />
              Archidekt
            </span>
            <span className="flex items-center gap-1">
              <ExternalLink className="w-2.5 h-2.5" />
              MTGGoldfish
            </span>
          </div>
        </div>
      )}

      {/* File upload */}
      {tab === "file" && (
        <div
          className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border/50 hover:border-border"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-file"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.dek,.dec,.mwDeck"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file"
          />

          {fileMutation.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground">Deciphering the scroll...</p>
            </div>
          ) : selectedFile ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">{selectedFile.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-6 h-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Drop a scroll here, or click to browse
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                Accepts .txt, .dek (MTGO), .dec
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
