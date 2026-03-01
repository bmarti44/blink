//! Service Registry - Dependency Injection Container
//!
//! This implements the service registry pattern from VS Code/openvscode-server.
//! Services are registered with descriptors for lazy instantiation.
//!
//! Usage:
//! ```rust
//! let registry = ServiceRegistry::new();
//! registry.register::<EnvironmentService, _>(|r| EnvironmentService::new(&app), true);
//! let env_service = registry.get::<EnvironmentService>().unwrap();
//! ```

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;

/// Marker trait for all services
pub trait Service: Send + Sync + Any {
    /// Get service as Any for downcasting
    fn as_any(&self) -> &dyn Any;

    /// Service identifier for debugging
    fn service_id(&self) -> &'static str;
}

/// Service descriptor for lazy instantiation
struct ServiceDescriptor {
    /// Factory function that creates the service
    factory: Box<dyn Fn(&ServiceRegistry) -> Arc<dyn Any + Send + Sync> + Send + Sync>,
    /// Whether to cache the instance (singleton)
    singleton: bool,
}

/// The service registry (DI container)
pub struct ServiceRegistry {
    /// Cached singleton instances
    instances: RwLock<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
    /// Service descriptors for lazy creation
    descriptors: RwLock<HashMap<TypeId, ServiceDescriptor>>,
    /// Track instantiation stack for circular dependency detection
    instantiation_stack: RwLock<Vec<TypeId>>,
}

impl ServiceRegistry {
    /// Create a new empty service registry
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            instances: RwLock::new(HashMap::new()),
            descriptors: RwLock::new(HashMap::new()),
            instantiation_stack: RwLock::new(Vec::new()),
        })
    }

    /// Register a service instance directly (for already-created services)
    pub fn set<T: Service + 'static>(&self, service: T) {
        let type_id = TypeId::of::<T>();
        let arc: Arc<dyn Any + Send + Sync> = Arc::new(service);
        self.instances.write().insert(type_id, arc);
    }

    /// Register a service with a factory function (lazy instantiation)
    ///
    /// # Arguments
    /// * `factory` - Function that creates the service
    /// * `singleton` - If true, instance is cached after first creation
    pub fn register<T, F>(&self, factory: F, singleton: bool)
    where
        T: Service + 'static,
        F: Fn(&ServiceRegistry) -> T + Send + Sync + 'static,
    {
        let type_id = TypeId::of::<T>();
        let descriptor = ServiceDescriptor {
            factory: Box::new(move |registry| {
                Arc::new(factory(registry)) as Arc<dyn Any + Send + Sync>
            }),
            singleton,
        };
        self.descriptors.write().insert(type_id, descriptor);
    }

    /// Get a service instance
    ///
    /// Returns None if the service is not registered.
    /// Panics if circular dependency detected.
    pub fn get<T: Service + 'static>(&self) -> Option<Arc<T>> {
        let type_id = TypeId::of::<T>();

        // Check cached instances first
        if let Some(instance) = self.instances.read().get(&type_id) {
            return instance.clone().downcast::<T>().ok();
        }

        // Check for circular dependency
        {
            let stack = self.instantiation_stack.read();
            if stack.contains(&type_id) {
                panic!(
                    "Circular dependency detected when instantiating {:?}",
                    std::any::type_name::<T>()
                );
            }
        }

        // Get descriptor info before instantiation
        let descriptor_info = {
            let descriptors = self.descriptors.read();
            descriptors.get(&type_id).map(|d| d.singleton)
        };

        if let Some(singleton) = descriptor_info {
            // Push to instantiation stack
            self.instantiation_stack.write().push(type_id);

            // Get factory and call it
            let instance = {
                let descriptors = self.descriptors.read();
                if let Some(desc) = descriptors.get(&type_id) {
                    Some((desc.factory)(self))
                } else {
                    None
                }
            };

            // Pop from instantiation stack
            self.instantiation_stack.write().pop();

            if let Some(instance) = instance {
                // Cache if singleton
                if singleton {
                    self.instances.write().insert(type_id, instance.clone());
                }

                return instance.downcast::<T>().ok();
            }
        }

        None
    }

    /// Check if a service is registered
    pub fn has<T: Service + 'static>(&self) -> bool {
        let type_id = TypeId::of::<T>();
        self.instances.read().contains_key(&type_id)
            || self.descriptors.read().contains_key(&type_id)
    }

    /// Remove a service (for testing or cleanup)
    pub fn remove<T: Service + 'static>(&self) {
        let type_id = TypeId::of::<T>();
        self.instances.write().remove(&type_id);
        self.descriptors.write().remove(&type_id);
    }

    /// Clear all services
    pub fn clear(&self) {
        self.instances.write().clear();
        self.descriptors.write().clear();
    }
}

impl Default for ServiceRegistry {
    fn default() -> Self {
        Self {
            instances: RwLock::new(HashMap::new()),
            descriptors: RwLock::new(HashMap::new()),
            instantiation_stack: RwLock::new(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestService {
        value: i32,
    }

    impl Service for TestService {
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn service_id(&self) -> &'static str {
            "TestService"
        }
    }

    #[test]
    fn test_set_and_get() {
        let registry = ServiceRegistry::new();
        registry.set(TestService { value: 42 });

        let service = registry.get::<TestService>().unwrap();
        assert_eq!(service.value, 42);
    }

    #[test]
    fn test_lazy_instantiation() {
        let registry = ServiceRegistry::new();
        registry.register::<TestService, _>(|_| TestService { value: 100 }, true);

        let service = registry.get::<TestService>().unwrap();
        assert_eq!(service.value, 100);
    }

    #[test]
    fn test_singleton_caching() {
        let registry = ServiceRegistry::new();
        let counter = std::sync::atomic::AtomicI32::new(0);

        registry.register::<TestService, _>(
            move |_| {
                TestService {
                    value: counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
                }
            },
            true,
        );

        let service1 = registry.get::<TestService>().unwrap();
        let service2 = registry.get::<TestService>().unwrap();

        // Should be the same instance (same value)
        assert_eq!(service1.value, service2.value);
        assert_eq!(service1.value, 0);
    }

    #[test]
    fn test_has() {
        let registry = ServiceRegistry::new();
        assert!(!registry.has::<TestService>());

        registry.set(TestService { value: 1 });
        assert!(registry.has::<TestService>());
    }

    #[test]
    fn test_remove() {
        let registry = ServiceRegistry::new();
        registry.set(TestService { value: 1 });
        assert!(registry.has::<TestService>());

        registry.remove::<TestService>();
        assert!(!registry.has::<TestService>());
    }
}
