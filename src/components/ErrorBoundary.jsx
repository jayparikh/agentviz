import React from "react";
import { theme } from "../lib/theme.js";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error) {
    console.error("AGENTVIZ render error:", error);
  }

  componentDidUpdate(prevProps) {
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 10,
          padding: 16,
          background: theme.bg.surface,
          border: "1px solid " + theme.semantic.errorBorder,
          borderRadius: theme.radius.lg,
          color: theme.text.secondary,
        }}>
          <div style={{ fontSize: theme.fontSize.md, color: theme.semantic.error }}>
            Inspector unavailable
          </div>
          <div style={{ fontSize: theme.fontSize.base, lineHeight: 1.6 }}>
            {this.state.error && this.state.error.message
              ? this.state.error.message
              : "This event could not be rendered safely."}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
