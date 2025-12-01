"use client";

import React, { useState, ChangeEvent, FormEvent, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { X, Send, Loader2, FileText, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/providers/SessionContextProvider";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import SourceDisplay from "@/components/SourceDisplay";

// PDF.js imports for client-side
import * as pdfjsLib from "pdfjs-dist";
import { GlobalWorkerOptions } from "pdfjs-dist/build/pdf";
// Set workerSrc for client-side PDF.js
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;


interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  created_at: string;
}

interface ProcessedFile extends File {
  extractedContent?: string;
  isProcessing?: boolean;
  extractionError?: string;
}

const ChatPage = () => {
  const { session, isLoading: isSessionLoading } = useSession();
  const navigate = useNavigate();

  const [question, setQuestion] = useState<string>("");
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [urls, setUrls] = useState<string[]>([""]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingResponse, setIsLoadingResponse] = useState<boolean>(false);
  const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Define accent colors for consistency
  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  useEffect(() => {
    if (!isSessionLoading && !session) {
      navigate("/login");
    }
  }, [session, isSessionLoading, navigate]);

  useEffect(() => {
    // Scroll to bottom of messages whenever messages update
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleQuestionChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
  };

  const extractPdfContentFromBuffer = async (arrayBuffer: ArrayBuffer): Promise<string | null> => {
    try {
      const uint8 = new Uint8Array(arrayBuffer);
      const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
      let extractedText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(" ");
        extractedText += pageText + "\n\n";
      }
      return extractedText.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.error("Error extracting PDF content:", error);
      return null;
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const filesToProcess: ProcessedFile[] = newFiles.map(file => ({ ...file, isProcessing: false }));
      setProcessedFiles(prev => [...prev, ...filesToProcess]);

      const processingPromises = filesToProcess.map(async (file) => {
        const updatedFile = { ...file };
        const fileType = file.type || ''; // Ensure fileType is a string for startsWith/includes

        if (fileType === 'application/pdf') {
          updatedFile.isProcessing = true;
          setProcessedFiles(prev => prev.map(f => f === file ? updatedFile : f)); // Update processing state
          try {
            const arrayBuffer = await file.arrayBuffer();
            updatedFile.extractedContent = await extractPdfContentFromBuffer(arrayBuffer);
            if (updatedFile.extractedContent) {
              showSuccess(`PDF content extracted from ${file.name}.`);
            } else {
              updatedFile.extractionError = `Failed to extract content from ${file.name}.`;
              showError(`Failed to extract PDF content from ${file.name}.`);
            }
          } catch (error: any) {
            console.error(`Error extracting PDF content from ${file.name}:`, error);
            updatedFile.extractionError = `Failed to extract PDF content: ${error.message}`;
            showError(`Failed to extract PDF content from ${file.name}.`);
          } finally {
            updatedFile.isProcessing = false;
            setProcessedFiles(prev => prev.map(f => f === file ? updatedFile : f)); // Update final state
          }
        } else if (fileType.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
          try {
            updatedFile.extractedContent = await file.text();
            showSuccess(`Text file ${file.name} content read.`);
          } catch (error: any) {
            console.error(`Error reading text file ${file.name}:`, error);
            updatedFile.extractionError = `Failed to read text file content: ${error.message}`;
            showError(`Failed to read text file content from ${file.name}.`);
          }
          setProcessedFiles(prev => prev.map(f => f === file ? updatedFile : f)); // Update final state
        } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
          // DOCX files are handled by Edge Function, no client-side extraction here.
          // Just add them to processedFiles without an error.
          showSuccess(`DOCX file ${file.name} ready for upload.`);
          setProcessedFiles(prev => prev.map(f => f === file ? updatedFile : f)); // Update final state
        }
        else {
          updatedFile.extractionError = `Unsupported file type for extraction: ${file.name}.`;
          showError(`Unsupported file type for extraction: ${file.name}.`);
          setProcessedFiles(prev => prev.map(f => f === file ? updatedFile : f)); // Update final state
        }
        return updatedFile;
      });

      await Promise.all(processingPromises);
    }
  };

  const handleRemoveFile = (index: number) => {
    setProcessedFiles(processedFiles.filter((_, i) => i !== index));
  };

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
  };

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleLogout = async () => {
    setIsLoadingResponse(true); // Disable inputs during logout
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error logging out:", error);
      showError("Failed to log out.");
    } else {
      showSuccess("Logged out successfully!");
      navigate("/login"); // Redirect to login page after logout
    }
    setIsLoadingResponse(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || isLoadingResponse) return;

    const userId = session.user.id;
    const trimmedQuestion = question.trim();
    const filteredUrls = urls.filter(url => url.trim() !== "");
    const validFiles = processedFiles.filter(file => !file.extractionError);

    if (!trimmedQuestion && validFiles.length === 0 && filteredUrls.length === 0) {
      showError("Please provide a question, files, or URLs.");
      return;
    }

    setIsLoadingResponse(true);

    try {
      let currentChat = currentChatId;
      let allSourceIdsForLLM: string[] = [];

      if (!currentChat) {
        // Create a new chat if it's the first message
        const { data: newChat, error: chatError } = await supabase
          .from("chats")
          .insert({ user_id: userId, title: trimmedQuestion.substring(0, 50) || "New Chat" })
          .select()
          .single();

        if (chatError) throw chatError;
        currentChat = newChat.id;
        setCurrentChatId(newChat.id);
      } else {
        // For existing chat, fetch all existing sources
        const { data: existingSources, error: fetchExistingSourcesError } = await supabase
          .from("sources")
          .select("id")
          .eq("chat_id", currentChat)
          .eq("user_id", userId);

        if (fetchExistingSourcesError) {
          console.error("Error fetching existing sources:", fetchExistingSourcesError);
          showError("Failed to retrieve existing sources for this chat.");
          // Continue without existing sources if there's an error
        } else {
          allSourceIdsForLLM = existingSources?.map(s => s.id) || [];
        }
      }

      // Add user message to state and database
      const userMessage: Message = {
        id: crypto.randomUUID(), // Client-side ID for immediate display
        content: trimmedQuestion,
        role: "user",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const { error: insertUserMessageError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: trimmedQuestion, role: "user" });
      if (insertUserMessageError) throw insertUserMessageError;

      // Handle new file uploads to Supabase Storage and create source entries
      const fileProcessingPromises = validFiles.map(async (file) => {
        const filePath = `${userId}/${currentChat}/${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("chat-files")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          console.error("Error uploading file:", uploadError);
          showError(`Failed to upload file ${file.name}: ${uploadError.message}`);
          return null; // Indicate failure for this file
        }

        let sourceIdToReturn = null;
        const fileType = file.type || ''; // Ensure fileType is a string

        if (fileType === 'application/pdf') {
          // Generate a signed URL for the uploaded PDF
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from("chat-files")
            .createSignedUrl(filePath, 3600); // URL valid for 1 hour

          if (signedUrlError || !signedUrlData?.signedUrl) {
            console.error("Error generating signed URL for PDF:", signedUrlError);
            showError(`Failed to generate URL for PDF ${file.name}.`);
            return null;
          }
          const signedUrl = signedUrlData.signedUrl;

          // Insert source entry as type 'url' with the signed URL and pre-extracted content
          const { data: sourceData, error: insertSourceError } = await supabase
            .from("sources")
            .insert({ chat_id: currentChat, user_id: userId, type: "url", name: signedUrl, content: file.extractedContent, storage_path: filePath })
            .select("id")
            .single();

          if (insertSourceError) {
            console.error("Error inserting PDF source as URL:", insertSourceError);
            showError(`Failed to record PDF source ${file.name}: ${insertSourceError.message}`);
            return null;
          }
          showSuccess(`PDF file ${file.name} uploaded and registered as a URL source.`);
          sourceIdToReturn = sourceData.id;

        } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
          // Existing DOCX logic
          const { data: sourceData, error: insertSourceError } = await supabase
            .from("sources")
            .insert({ chat_id: currentChat, user_id: userId, type: fileType, name: file.name, storage_path: filePath })
            .select("id")
            .single();

          if (insertSourceError) {
            console.error("Error inserting DOCX source:", insertSourceError);
            showError(`Failed to record DOCX source ${file.name}: ${insertSourceError.message}`);
            return null;
          }

          const { data: extractData, error } = await supabase.functions.invoke("extract-docx", {
            body: { sourceId: sourceData.id },
          });
          const edgeFunctionError = error || extractData.error;
          const extractedContent = extractData?.extractedContent;
          if (edgeFunctionError) {
            console.error(`Error invoking extract-docx for ${file.name}:`, edgeFunctionError);
            showError(`Failed to extract text from DOCX ${file.name}: ${edgeFunctionError.message || edgeFunctionError}`);
          } else if (!extractedContent) {
            showError(`No content extracted from DOCX ${file.name}.`);
          } else {
            showSuccess(`DOCX content extracted and saved for ${file.name}.`);
            // Update the source with extracted content
            const { error: updateContentError } = await supabase
              .from("sources")
              .update({ content: extractedContent })
              .eq("id", sourceData.id);
            if (updateContentError) {
              console.error(`Error updating source ${sourceData.id} with DOCX content:`, updateContentError);
              showError(`Failed to save extracted content for ${file.name}.`);
            }
          }
          sourceIdToReturn = sourceData.id;

        } else if (fileType.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
          // Existing text file logic, now using pre-extracted content
          const { data: sourceData, error: insertSourceError } = await supabase
            .from("sources")
            .insert({ chat_id: currentChat, user_id: userId, type: fileType, name: file.name, storage_path: filePath, content: file.extractedContent })
            .select("id")
            .single();

          if (insertSourceError) {
            console.error("Error inserting text file source:", insertSourceError);
            showError(`Failed to record text file source ${file.name}: ${insertSourceError.message}`);
            return null;
          }

          showSuccess(`Text file ${file.name} uploaded with content.`);
          sourceIdToReturn = sourceData.id;

        } else {
          showError(`Unsupported file type for upload: ${file.name}.`);
          return null; // Do not add source if type is unsupported
        }
        
        return sourceIdToReturn; // Return the source ID for successful processing
      });

      const newFileSourceIds = (await Promise.all(fileProcessingPromises)).filter(Boolean) as string[];
      allSourceIdsForLLM.push(...newFileSourceIds);

      // Handle new URLs as sources
      const urlProcessingPromises = filteredUrls.map(async (url) => {
        const { data: sourceData, error: insertSourceError } = await supabase
          .from("sources")
          .insert({ chat_id: currentChat, user_id: userId, type: "url", name: url, content: url }) // content initially stores the URL itself
          .select("id")
          .single();

        if (insertSourceError) {
          console.error("Error inserting URL source:", insertSourceError);
          showError(`Failed to record URL source ${url}: ${insertSourceError.message}`);
          return null;
        }
        return sourceData.id;
      });

      const newUrlSourceIds = (await Promise.all(urlProcessingPromises)).filter(Boolean) as string[];
      allSourceIdsForLLM.push(...newUrlSourceIds);

      // Remove duplicates from allSourceIdsForLLM if any
      allSourceIdsForLLM = Array.from(new Set(allSourceIdsForLLM));

      // Prepare conversation history for the LLM (last 10 messages)
      const conversationHistoryForLLM = messages.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Invoke Edge Function with question, all relevant source IDs, and conversation history
      const { data, error: edgeFunctionError } = await supabase.functions.invoke("ask-llm", {
        body: {
          question: trimmedQuestion,
          sourceIds: allSourceIdsForLLM, // Pass the combined list of source IDs
          messages: conversationHistoryForLLM,
        },
      });

      if (edgeFunctionError) throw edgeFunctionError;
      if (data.error) throw new Error(data.error);

      const assistantResponseContent = data.response || "No response from LLM.";

      // Add assistant message to state and database
      const assistantMessage: Message = {
        id: crypto.randomUUID(), // Client-side ID for immediate display
        content: assistantResponseContent,
        role: "assistant",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const { error: insertAssistantMessageError } = await supabase
        .from("messages")
        .insert({ chat_id: currentChat, user_id: userId, content: assistantResponseContent, role: "assistant" });
      if (insertAssistantMessageError) throw insertAssistantMessageError;

      setQuestion("");
      setProcessedFiles([]); // Clear processed files after submission
      setUrls([""]);
      showSuccess("Response received!");

    } catch (error: any) {
      console.error("Chat submission error:", error);
      showError(`Failed to get response: ${error.message || "Unknown error"}`);
    } finally {
      setIsLoadingResponse(false);
    }
  };

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        <p className="ml-2 text-xl text-gray-600 dark:text-gray-400">Loading session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-lg rounded-lg flex flex-col h-[90vh]">
        <CardHeader className="pb-4 relative flex items-center justify-between">
          <CardTitle
            className="text-3xl font-bold text-gray-900 dark:text-white"
            style={{ color: secondaryAccentColor }}
          >
            Smart Chat
          </CardTitle>
          <div className="flex items-center space-x-2">
            {currentChatId && (
              <Dialog open={isSourcesDialogOpen} onOpenChange={setIsSourcesDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
                  >
                    <FileText className="h-4 w-4 mr-2" /> View Sources
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto dark:bg-gray-800">
                  <DialogHeader>
                    <DialogTitle className="text-gray-900 dark:text-white">Chat Sources</DialogTitle>
                  </DialogHeader>
                  <SourceDisplay chatId={currentChatId} />
                </DialogContent>
              </Dialog>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
              disabled={isLoadingResponse}
            >
              <LogOut className="h-4 w-4 mr-2" /> Logout
            </Button>
          </div>
        </CardHeader>
        <div className="flex-grow flex flex-col overflow-hidden">
          {/* Message Display Area */}
          <ScrollArea className="flex-grow px-6 pt-6 pb-4 border-t border-b dark:border-gray-700">
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400">
                  Start a conversation by asking a question or providing sources.
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <Avatar>
                      <AvatarImage src="/placeholder.svg" alt="Assistant" />
                      <AvatarFallback style={{ backgroundColor: secondaryAccentColor, color: primaryAccentColor }}>AI</AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={`max-w-[70%] p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                    }`}
                    style={msg.role === "user" ? { backgroundColor: primaryAccentColor, color: "white" } : {}}
                  >
                    <p className="text-sm">{msg.content}</p>
                    <p className="text-xs text-right mt-1 opacity-75">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  {msg.role === "user" && (
                    <Avatar>
                      <AvatarImage src="/placeholder.svg" alt="User" />
                      <AvatarFallback style={{ backgroundColor: primaryAccentColor, color: secondaryAccentColor }}>
                        {session?.user?.email ? session.user.email[0].toUpperCase() : "U"}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              {messages.length > 0 && <div ref={messagesEndRef} />}
            </div>
          </ScrollArea>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4 border-t dark:border-gray-700 flex-shrink-0">
            {/* Question Input */}
            <div>
              <Label htmlFor="question" className="sr-only">
                Your Question
              </Label>
              <Textarea
                id="question"
                placeholder="Type your question here..."
                value={question}
                onChange={handleQuestionChange}
                rows={2}
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={isLoadingResponse}
              />
            </div>

            {/* File Upload */}
            <div>
              <Label htmlFor="file-upload" className="text-sm font-medium mb-2 block">
                Upload Files (Supported: .txt, .pdf, .csv, .docx)
              </Label>
              <Input
                id="file-upload"
                type="file"
                multiple
                onChange={handleFileChange}
                className="block w-full h-auto py-2 text-sm text-gray-500 dark:text-gray-400"
                disabled={isLoadingResponse}
              />
              <div className="mt-2 space-y-1">
                {processedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded-md">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {file.name}
                      {file.isProcessing && <Loader2 className="ml-2 h-4 w-4 animate-spin inline-block" />}
                      {file.extractionError && <span className="ml-2 text-red-500 text-xs">({file.extractionError})</span>}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(index)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      disabled={isLoadingResponse || file.isProcessing}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* URL Input */}
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Provide Website URLs
              </Label>
              <div className="space-y-2">
                {urls.map((url, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <Input
                      type="url"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => handleUrlChange(index, e.target.value)}
                      className="flex-grow p-3 border rounded-md focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      disabled={isLoadingResponse}
                    />
                    {urls.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveUrl(index)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        disabled={isLoadingResponse}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" onClick={handleAddUrl} variant="outline" className="w-full" disabled={isLoadingResponse}>
                  Add another URL
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-3 text-lg font-semibold"
              style={{ backgroundColor: primaryAccentColor, color: "#030816" }}
              disabled={isLoadingResponse || processedFiles.some(f => f.isProcessing)}
            >
              {isLoadingResponse ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Getting Response...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit
                </>
              )}
            </Button>
          </form>
        </div>
      </Card>
      <MadeWithDyad />
    </div>
  );
};

export default ChatPage;