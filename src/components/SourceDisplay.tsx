"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/providers/SessionContextProvider";
import { Loader2, FileText, Link, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { showError } from "@/utils/toast";

interface Source {
  id: string;
  type: string;
  name: string;
  content?: string;
  storage_path?: string;
  created_at: string;
}

interface SourceDisplayProps {
  chatId: string;
}

const SourceDisplay = ({ chatId }: SourceDisplayProps) => {
  const { session } = useSession();
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSources = async () => {
      if (!session?.user?.id || !chatId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("chat_id", chatId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching sources:", error);
        showError("Failed to load sources.");
        setSources([]);
      } else {
        setSources(data || []);
      }
      setIsLoading(false);
    };

    fetchSources();
  }, [chatId, session?.user?.id]);

  const handleDownload = async (filePath: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("chat-files")
        .download(filePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Error downloading file:", error);
      showError(`Failed to download file: ${error.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">Loading sources...</span>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
        Sources for this Chat
      </h2>
      {sources.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No sources uploaded or provided for this chat yet.</p>
      ) : (
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {sources.map((source) => (
              <Card key={source.id} className="dark:bg-gray-700">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-medium flex items-center gap-2">
                    {source.type === "url" ? <Link className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    {source.name}
                  </CardTitle>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(source.created_at).toLocaleDateString()}
                  </span>
                </CardHeader>
                <CardContent>
                  {source.type === "url" && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                      URL: <a href={source.name} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{source.name}</a>
                    </p>
                  )}
                  {source.storage_path && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(source.storage_path!, source.name)}
                      className="mt-2 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
                    >
                      <Download className="h-4 w-4 mr-2" /> Download File
                    </Button>
                  )}
                  {source.content && (
                    <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-md text-sm text-gray-800 dark:text-gray-200 max-h-32 overflow-y-auto">
                      <h4 className="font-semibold mb-1">Extracted Content Preview:</h4>
                      <p className="line-clamp-3">{source.content}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default SourceDisplay;