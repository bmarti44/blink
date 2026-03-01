//! IPC Channels
//!
//! This module provides the channel-based IPC system for communication
//! between the frontend and backend services.

pub mod channel;
pub mod extension_host_channel;
pub mod messages;
pub mod router;

pub use channel::*;
pub use extension_host_channel::*;
pub use messages::*;
pub use router::*;
