"use client";

import React, { useState, ChangeEvent, FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ChatPage = () => {
  const [question, setQuestion] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([""]); // Start with one empty URL input
  const navigate = useNavigate();

  // Define accent colors for consistency
  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  const handleQuestionChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    console.log("Question:", question);
    console.log("Files:", files);
    console.log("URLs:", urls.filter(url => url.trim() !== "")); // Filter out empty URLs
    // In a real application, you would send this data to a backend or Supabase function
    // For now, we'll just log it.
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-2xl bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
        <CardHeader>
          <CardTitle
            className="text-3xl font-bold text-center mb-6 text-gray-900 dark:text-white"
            style={{ color: secondaryAccentColor }} // Apply secondary accent color
          >
            Ask a Question
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Question Input */}
            <div>
              <Label htmlFor="question" className="text-lg font-medium mb-2 block">
                Your Question
              </Label>
              <Textarea
                id="question"
                placeholder="Type your question here..."
                value={question}
                onChange={handleQuestionChange}
                rows={4}
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>

            {/* File Upload */}
            <div>
              <Label htmlFor="file-upload" className="text-lg font-medium mb-2 block">
                Upload Files (PDF, Text, DOC/DOCx)
              </Label>
              <Input
                id="file-upload"
                type="file"
                multiple
                onChange={handleFileChange}
                className="block w-full h-auto py-2 text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold dark:text-gray-400"
                style={{
                  "--file-bg": secondaryAccentColor,
                  "--file-text": primaryAccentColor,
                } as React.CSSProperties} // Apply custom properties for file button styling
              />
              <div className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded-md">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(index)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* URL Input */}
            <div>
              <Label className="text-lg font-medium mb-2 block">
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
                    />
                    {urls.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveUrl(index)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" onClick={handleAddUrl} variant="outline" className="w-full">
                  Add another URL
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-3 text-lg font-semibold"
              style={{ backgroundColor: primaryAccentColor, color: "hsl(var(--foreground))" }} // Changed text color to foreground
            >
              Submit
            </Button>
          </form>
        </CardContent>
      </Card>
      <MadeWithDyad />
    </div>
  );
};

export default ChatPage;